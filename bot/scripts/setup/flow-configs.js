/**
 * flow-configs — the single source of truth for which WhatsApp Flows this
 * deployment registers.
 *
 * Both the registrar (`register-all-flows`) and the validators
 * (`setup-state`, `validate-flows`) import from here, so the set of flows that
 * gets registered can never drift from the set that gets validated. Adding a
 * new flow = add one entry here + drop its JSON in `docs/flows/`.
 *
 * Each entry:
 *   name          Human-readable flow name (also the key used in setup state).
 *   jsonPath      Absolute path to the Flow JSON shipped in docs/flows/.
 *   type          'navigate' (no server endpoint) | 'endpoint' (data-exchange).
 *   endpointPath  (endpoint only) path appended to the deployment's base URL.
 *                 MUST match a route mounted under `/api/flows` in
 *                 flow-endpoint.routes.js (the router is mounted at
 *                 `app.use('/api/flows', ...)` in whatsapp-bot.js), e.g.
 *                 `/api/flows/settings`. A mismatch registers the Flow's data
 *                 endpoint at a 404 path. The flow-config-conformance test
 *                 guards this.
 *   envVar        The .env variable the registered Flow ID is written back to.
 *   categories    Meta Flow categories.
 */

const path = require('path');

// Flow JSON lives in the repo-root docs/flows/ directory (single location).
const FLOWS_DIR = path.resolve(__dirname, '../../../docs/flows');

const FLOW_CONFIGS = [
  {
    name: 'Reading Assessment',
    jsonPath: path.join(FLOWS_DIR, 'reading-assessment-flow-v2.json'),
    type: 'navigate',
    envVar: 'READING_ASSESSMENT_FLOW_ID',
    categories: ['OTHER'],
  },
  {
    name: 'Attendance Setup',
    jsonPath: path.join(FLOWS_DIR, 'attendance-setup-flow.json'),
    type: 'endpoint',
    endpointPath: '/api/flows/attendance-setup',
    envVar: 'ATTENDANCE_SETUP_FLOW_ID',
    categories: ['OTHER'],
  },
  {
    name: 'Attendance Marking',
    jsonPath: path.join(FLOWS_DIR, 'attendance-marking-flow.json'),
    type: 'endpoint',
    endpointPath: '/api/flows/attendance-marking',
    envVar: 'ATTENDANCE_MARKING_FLOW_ID',
    categories: ['OTHER'],
  },
  {
    name: 'Settings',
    jsonPath: path.join(FLOWS_DIR, 'settings-flow.json'),
    type: 'endpoint',
    endpointPath: '/api/flows/settings',
    envVar: 'SETTINGS_FLOW_ID',
    categories: ['OTHER'],
  },
  {
    name: 'Status',
    jsonPath: path.join(FLOWS_DIR, 'status-flow.json'),
    type: 'endpoint',
    endpointPath: '/api/flows/status',
    envVar: 'STATUS_FLOW_ID',
    categories: ['OTHER'],
  },
  {
    name: 'Homework Request',
    jsonPath: path.join(FLOWS_DIR, 'homework-request-flow.json'),
    type: 'endpoint',
    endpointPath: '/api/flows/homework-request',
    envVar: 'HOMEWORK_FLOW_ID',
    categories: ['OTHER'],
  },
  {
    name: 'Edit Class',
    jsonPath: path.join(FLOWS_DIR, 'edit-class-flow.json'),
    type: 'endpoint',
    endpointPath: '/api/flows/edit-class',
    envVar: 'EDIT_CLASS_FLOW_ID',
    categories: ['OTHER'],
  },
  {
    name: 'Student Videos',
    jsonPath: path.join(FLOWS_DIR, 'student-videos-flow.json'),
    type: 'endpoint',
    endpointPath: '/api/flows/student-videos',
    envVar: 'STUDENT_VIDEOS_FLOW_ID',
    categories: ['OTHER'],
  },
  {
    name: 'Pic-to-LP Confirm',
    jsonPath: path.join(FLOWS_DIR, 'pic-lp-confirm-flow.json'),
    type: 'endpoint',
    endpointPath: '/api/flows/pic-lp',
    envVar: 'PIC_LP_FLOW_ID',
    categories: ['OTHER'],
  },
  {
    name: 'Quiz Manager',
    jsonPath: path.join(FLOWS_DIR, 'quiz-flow.json'),
    type: 'endpoint',
    endpointPath: '/api/flows/quiz',
    envVar: 'QUIZ_FLOW_ID',
    categories: ['OTHER'],
  },
];

/** The flow names that a complete setup must have registered. */
const REQUIRED_FLOW_NAMES = FLOW_CONFIGS.map((c) => c.name);

module.exports = { FLOW_CONFIGS, REQUIRED_FLOW_NAMES, FLOWS_DIR };
