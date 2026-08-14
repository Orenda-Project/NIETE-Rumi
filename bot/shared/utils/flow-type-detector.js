/**
 * Flow Type Detector
 *
 * Determines the type of WhatsApp Flow from the webhook's response_json fields.
 * Used by whatsapp-bot.js to route nfm_reply messages to the correct handler.
 *
 * Flow types:
 * - training_msq: Training multi-answer question (training_msq_action)
 * - reading_assessment: Reading assessment flow (Student_Full_Name, Assessment_Mode)
 * - exam_generator: Exam generator flow (`:exam-generator:` in flow_token)
 * - attendance_setup: Class setup flow (class_name + student_list/students_text)
 * - attendance_marking: Attendance marking flow (absent_students or attendance flow_token)
 * - registration: User registration flow (full_name + country, or :registration: in flow_token)
 * - unknown: Unrecognized flow
 *
 * Detection priority (order matters):
 * 1. Reading assessment (most specific fields)
 * 2. Registration (check BEFORE attendance to avoid flow_token collision)
 * 3. Exam generator (check BEFORE attendance — flow_token contains colons that
 *    would otherwise match the loose attendance_marking fallback)
 * 4. Attendance setup
 * 5. Attendance marking
 * 6. Unknown
 *
 * Created: February 11, 2026
 */

/**
 * Detect the flow type from webhook response_json fields
 *
 * @param {Object} responseJson - Parsed response_json from nfm_reply
 * @returns {string} - Flow type: 'reading_assessment' | 'attendance_setup' | 'attendance_marking' | 'registration' | 'unknown'
 */
function detectFlowType(responseJson) {
  if (!responseJson || typeof responseJson !== 'object') {
    return 'unknown';
  }

  // 0. Teacher Training (highest priority — unique field, no risk of collision)
  //    Emitted by teacher-training-endpoint.js buildSuccessScreen() as the
  //    extension_message_response.params on Flow close.
  if (responseJson.training_action !== undefined) {
    return 'teacher_training';
  }

  // 0b. Supervisor Remark (bd-2712). Tagged, not shape-guessed — and checked
  //     EARLY because the attendance_marking branch below matches any flow_token
  //     containing a colon, which is close enough to a catch-all that a new flow
  //     can be swallowed by it. (This flow's token is a bare user UUID with no
  //     colon, so it would not match today; ordering keeps that true if the
  //     token format ever changes.)
  if (responseJson.remark_action !== undefined) {
    return 'remark';
  }

  // 0.05 Training multi-answer question — the select-all-that-apply
  //      CheckboxGroup Flow. The screen echoes training_msq_action in its
  //      completion payload; the field is unique to this flow, so the rule
  //      cannot false-positive. MUST sit above the loose attendance_marking
  //      fallback: the token `<userId>:training-msq:<attemptId>:<index>` is
  //      full of colons and would otherwise be misrouted to attendance —
  //      the same class of bug that hit the exam-generator and observe flows.
  if (responseJson.training_msq_action !== undefined) {
    return 'training_msq';
  }

  // 0.1 Observe (FEAT-102) — the editable FICO observation form submission.
  //     The endpoint returns extension_message_response.params.observe_action.
  //     Unique field; MUST be detected before the loose attendance_marking
  //     flow_token fallback — the observe token 'observerId:sessionId' has a
  //     colon and would otherwise misroute to attendance.
  if (responseJson.observe_action !== undefined) {
    return 'observe';
  }

  // 0.2 Observe Visit picker (bd-2432, port of main-bot FEAT-116 bd-2301).
  //     The "Start observation" completion carries teacher_ext_id + step —
  //     teacher_ext_id is UNIQUE to this flow, so the rule is false-positive-
  //     proof. MUST sit above the loose attendance_marking flow_token fallback
  //     (any ':' in the token) — the exact misroute class that hit the
  //     exam-generator on 2026-07-12 and observe (0.1) before it.
  if (responseJson.teacher_ext_id !== undefined && responseJson.step !== undefined) {
    return 'observe_visit';
  }
  // bd-2444: the scheduling UI's other exits (debrief tap, "I'm done") carry
  // an explicit discriminator — same misroute-proofing as above.
  if (responseJson.observe_visit_action !== undefined) {
    return 'observe_visit';
  }

  // 1. Reading Assessment (highest priority - unique fields)
  const hasReadingFields = responseJson.screen_0_Student_Full_Name_0 ||
                           responseJson.screen_0_Select_the_reading_level_2 ||
                           responseJson.Student_Full_Name ||
                           responseJson.Assessment_Mode;

  if (hasReadingFields) {
    return 'reading_assessment';
  }

  // 2. Registration (check BEFORE attendance to prevent flow_token collision)
  // Registration flow_token format: userId:registration:timestamp
  const isRegistrationByToken = responseJson.flow_token?.includes(':registration:');
  const hasRegistrationFields = responseJson.full_name !== undefined &&
                                responseJson.country !== undefined;

  if (isRegistrationByToken || hasRegistrationFields) {
    return 'registration';
  }

  // 2.5. Exam Generator (endpoint flow — terminal ack; the endpoint at
  // /api/flows/exam-generator has already queued the SQS `exam_generate` job
  // by the time this NFM_REPLY arrives; the SQS worker sends follow-up chat
  // messages + the .docx. Nothing to do here except identify the flow so it
  // isn't misrouted by the loose attendance-marking fallback below.
  //
  // Flow token from text-message.handler.js:678 is `${user.id}:exam-generator:${ts}`.
  // The two colons here would otherwise match the attendance_marking check.
  //
  // Bug caught 2026-07-12 during live E2E — teacher saw "Sorry, error recording
  // attendance: Failed to fetch students" after clicking "Generate exam", because
  // the exam-generator flow_token matched the loose attendance-marking fallback.
  if (responseJson.flow_token?.includes(':exam-generator:')) {
    return 'exam_generator';
  }

  // 2.6. Assessment Generator — external UG_EG-backed flow.
  // Flow token from text-message.handler.js is `${user.id}:assessment-gen:${ts}`.
  // The flow endpoint has already submitted the job to UG_EG; the callback at
  // /webhooks/assessment-generator will deliver the PDF asynchronously.
  // Nothing to do on the NFM_REPLY except identify it (same reason as
  // exam-generator above — avoid the loose attendance-marking fallback).
  if (responseJson.flow_token?.includes(':assessment-gen:')) {
    return 'assessment_generator';
  }

  // 3. Attendance Setup (class creation)
  // Navigate-based format: class_name + student_list/students_text
  // Endpoint-based format: list_id + class_display (from extension_message_response.params)
  const hasNavigateSetupFields = responseJson.class_name &&
                                 (responseJson.student_list || responseJson.students_text);
  const hasEndpointSetupFields = responseJson.list_id && responseJson.class_display;

  if (hasNavigateSetupFields || hasEndpointSetupFields) {
    return 'attendance_setup';
  }

  // 4. Attendance Marking (tap-to-mark absent)
  // flow_token format: userId:classId:date:sessionType:encodedClassName
  // MUST NOT match registration tokens (which contain :registration:)
  const hasAttendanceMarkingFields = responseJson.absent_students !== undefined ||
    (responseJson.flow_token?.includes(':') && !responseJson.flow_token?.includes(':registration:'));

  if (hasAttendanceMarkingFields) {
    return 'attendance_marking';
  }

  return 'unknown';
}

module.exports = { detectFlowType };
