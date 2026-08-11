/**
 * WhatsApp Flow Endpoint Routes
 *
 * Handles encrypted data exchange for WhatsApp Flows with data_api_version 3.0+
 *
 * Endpoints:
 * - POST /api/flows/registration - Handle registration flow data requests
 *
 * Created: January 25, 2026
 * Updated: February 17, 2026 (Registration Flow v3 added)
 */

const express = require('express');
const router = express.Router();
const FlowEncryptionService = require('../services/flow-encryption.service');
const StudentListService = require('../services/student-list.service');
const { handleObserveMewakaRequest } = require('./observe-mewaka-endpoint'); // FEAT-102 — /observe editable FICO form
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const {
  handleMarkingInit,
  handleMarkingDataExchange
} = require('./attendance-marking-endpoint');
const {
  handleEditClassInit,
  handleEditClassDataExchange
} = require('./edit-class-endpoint');
const {
  handleSetupInit,
  handleSetupDataExchange
} = require('./attendance-setup-endpoint');
const {
  handleRegistrationInit,
  handleRegistrationDataExchange,
  handleRegistrationBack
} = require('./registration-endpoint');
const {
  handlePicLpInit,
  handlePicLpDataExchange,
  handlePicLpBack
} = require('./pic-lp-endpoint');
const {
  handleSettingsInit,
  handleSettingsDataExchange,
  handleSettingsBack
} = require('./settings-endpoint');
const {
  handleStatusFlowInit,
  handleStatusFlowDataExchange,
  handleStatusFlowBack
} = require('./status-flow-endpoint');
const {
  handleStudentVideosInit,
  handleStudentVideosDataExchange,
  handleStudentVideosBack
} = require('./student-videos-endpoint');
const {
  handleHomeworkInit,
  handleHomeworkDataExchange,
  handleHomeworkBack
} = require('./homework-request-endpoint');
const {
  handleQuizFlowInit,
  handleQuizFlowDataExchange,
  handleQuizFlowBack
} = require('./quiz-flow-endpoint');
const {
  handleTrainingMsqInit,
  handleTrainingMsqDataExchange,
  handleTrainingMsqBack
} = require('./training-msq-endpoint');
const {
  handleExamConfirmInit,
  handleExamConfirmDataExchange,
  handleExamConfirmBack
} = require('./exam-confirm-endpoint');
const {
  handleTeacherTrainingInit,
  handleTeacherTrainingDataExchange,
  handleTeacherTrainingBack
} = require('./teacher-training-endpoint');
const {
  handleExamGeneratorInit,
  handleExamGeneratorDataExchange,
  handleExamGeneratorBack
} = require('./exam-generator-endpoint');
const {
  handleAssessmentGenInit,
  handleAssessmentGenDataExchange,
  handleAssessmentGenBack
} = require('./assessment-gen-endpoint');
const {
  handlePakistanLpInit,
  handlePakistanLpDataExchange,
  handlePakistanLpBack
} = require('./pakistan-lp-endpoint');

/**
 * Handle attendance marking flow data requests
 *
 * Actions:
 * - ping: Health check
 * - INIT: Initialize flow with student data
 * - data_exchange: Not used for this flow (no dynamic updates needed)
 */

/**
 * Handle attendance setup flow data requests
 *
 * Actions:
 * - ping: Health check
 * - INIT: Initialize flow with CLASS_INFO screen
 * - data_exchange: Handle screen submissions (CLASS_INFO → ADD_STUDENT → SUCCESS)
 */

/**
 * Handle registration flow data requests
 *
 * Actions:
 * - ping: Health check
 * - INIT: Initialize flow with PERSONAL_INFO screen
 * - data_exchange: Handle screen submissions (PERSONAL_INFO → PROFESSIONAL_INFO → SUCCESS)
 * - BACK: Navigate to previous screen
 */
/**
 * FEAT-102 — /observe editable FICO observation form (endpoint-based data_exchange).
 * The handler is pack-driven (getObservePack → FICO), so this ONE route serves
 * the FICO 5-screen form. Publish the Flow with endpoint_uri .../api/flows/observe-mewaka
 * (the env var OBSERVE_MEWAKA_FLOW_ID is legacy-named; the path is generic).
 */
router.post('/observe-mewaka', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'observe-mewaka' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => handleObserveMewakaRequest(decryptedData)
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', { endpoint: 'observe-mewaka', error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * bd-2432 (port of main-bot FEAT-116) — the /observe visit picker
 * (school → teacher → support brief, endpoint-based data_exchange).
 * Publish the Flow with endpoint_uri .../api/flows/observe-visit and set
 * OBSERVE_VISIT_FLOW_ID. flow_token = the coach's bare user.id.
 */
router.post('/observe-visit', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'observe-visit' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => {
        const { action, flow_token: flowToken, screen, data: screenData } = decryptedData;
        if (action === 'ping') return FlowEncryptionService.handlePing();
        const userId = (flowToken || '').split(':')[0];
        const VisitHandler = require('../handlers/observe-visit-flow.handler');
        return VisitHandler.handle(userId, action, screen, screenData || {}, flowToken);
      }
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', { endpoint: 'observe-visit', error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.post('/registration', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'registration' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }

    const encryptedRequest = req.body;

    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      encryptedRequest,
      async (decryptedData) => {
        return await handleRegistrationRequest(decryptedData);
      }
    );

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', {
      endpoint: 'registration',
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * Handle decrypted registration request
 * @param {Object} data - Decrypted request data
 * @returns {Object} - Response to encrypt
 */
async function handleRegistrationRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;

  logToFile('Handling registration request', {
    action,
    screen,
    hasFlowToken: !!flow_token,
    screenDataKeys: screenData ? Object.keys(screenData) : []
  });

  let response;

  // Handle ping (health check)
  if (action === 'ping') {
    response = FlowEncryptionService.handlePing();
    logToFile('📤 Returning ping response', { response });
    return response;
  }

  // Parse flow token to get user ID
  // Flow token format: "userId:registration:timestamp"
  const userId = (flow_token || '').split(':')[0];

  // Handle INIT (check both cases - learned from attendance bugs)
  if (action === 'INIT' || action === 'init') {
    response = await handleRegistrationInit(userId);
    logToFile('📤 Returning INIT response', { response: JSON.stringify(response) });
    return response;
  }

  // Handle data_exchange
  if (action === 'data_exchange') {
    response = await handleRegistrationDataExchange(userId, screen, screenData, flow_token);
    logToFile('📤 Returning data_exchange response', {
      screen: response?.screen,
      dataKeys: response?.data ? Object.keys(response.data) : [],
      responsePreview: JSON.stringify(response).substring(0, 500)
    });
    return response;
  }

  // Handle BACK navigation
  if (action === 'BACK') {
    response = await handleRegistrationBack(userId, screen, flow_token);
    logToFile('📤 Returning BACK response', { response: JSON.stringify(response) });
    return response;
  }

  // Unknown action
  logToFile('Unknown flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

/**
 * POST /api/flows/pic-lp — Pic-to-LP confirmation Flow data endpoint.
 * Single-screen form (PIC_LP_FORM → SUCCESS); the teacher confirms
 * grade/subject/topic/language and LP generation fires in the background.
 */
router.post('/pic-lp', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'pic-lp' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }

    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => {
        return await handlePicLpRequest(decryptedData);
      }
    );

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', {
      endpoint: 'pic-lp',
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Handle decrypted pic-LP flow request. Routes by action; the flow_token
 * (format "pic_lp_form_<sessionId>") is passed straight through to the
 * endpoint handlers, which resolve the session via getByFlowToken.
 */
async function handlePicLpRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;

  logToFile('Handling pic-LP flow request', {
    action,
    screen,
    hasFlowToken: !!flow_token,
  });

  if (action === 'ping') {
    return FlowEncryptionService.handlePing();
  }
  if (action === 'INIT' || action === 'init') {
    return await handlePicLpInit(flow_token);
  }
  if (action === 'data_exchange') {
    return await handlePicLpDataExchange(flow_token, screen, screenData);
  }
  if (action === 'BACK') {
    return await handlePicLpBack(flow_token);
  }

  logToFile('Unknown flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

// ============================================================
// SETTINGS FLOW ENDPOINT
// ============================================================

router.post('/attendance-setup', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'attendance-setup' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }

    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => {
        return await handleAttendanceSetupRequest(decryptedData);
      }
    );

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', {
      endpoint: 'attendance-setup',
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Class setup — CLASS -> ROSTER -> REVIEW -> SUCCESS.
 * flow_token is the user id (set when the Flow is sent).
 */
async function handleAttendanceSetupRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;

  logToFile('Handling attendance-setup request', {
    action,
    screen,
    hasFlowToken: !!flow_token,
    screenDataKeys: screenData ? Object.keys(screenData) : []
  });

  if (action === 'ping') {
    return FlowEncryptionService.handlePing();
  }

  const userId = (flow_token || '').split(':')[0];

  if (action === 'INIT' || action === 'init') {
    return await handleSetupInit(userId);
  }
  if (action === 'data_exchange') {
    return await handleSetupDataExchange(userId, screen, screenData);
  }

  logToFile('Unknown attendance-setup flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

router.post('/attendance-marking', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'attendance-marking' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }

    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => {
        return await handleAttendanceMarkingRequest(decryptedData);
      }
    );

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', { endpoint: 'attendance-marking', error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

/** Marking — MARK -> LEAVE_TYPE -> CONFIRM -> SAVED. flow_token: "<userId>:<student|teacher>:<targetId>". */
async function handleAttendanceMarkingRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;

  logToFile('Handling attendance-marking request', {
    action, screen, hasFlowToken: !!flow_token,
    screenDataKeys: screenData ? Object.keys(screenData) : []
  });

  if (action === 'ping') {
    return FlowEncryptionService.handlePing();
  }

  if (action === 'INIT' || action === 'init') {
    return await handleMarkingInit(flow_token);
  }
  if (action === 'data_exchange') {
    return await handleMarkingDataExchange(flow_token, screen, screenData);
  }

  logToFile('Unknown attendance-marking flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

router.post('/edit-class', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'edit-class' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }

    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => {
        return await handleEditClassRequest(decryptedData);
      }
    );

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', { endpoint: 'edit-class', error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

/** Edit class — ROSTER -> ADD|REMOVE|RENAME -> SAVED. flow_token: "<userId>:<listId>". */
async function handleEditClassRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;

  logToFile('Handling edit-class request', {
    action, screen, hasFlowToken: !!flow_token,
    screenDataKeys: screenData ? Object.keys(screenData) : []
  });

  if (action === 'ping') {
    return FlowEncryptionService.handlePing();
  }

  if (action === 'INIT' || action === 'init') {
    return await handleEditClassInit(flow_token);
  }
  if (action === 'data_exchange') {
    return await handleEditClassDataExchange(flow_token, screen, screenData);
  }

  logToFile('Unknown edit-class flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

router.post('/settings', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'settings' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }

    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => {
        return await handleSettingsRequest(decryptedData);
      }
    );

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', {
      endpoint: 'settings',
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Handle decrypted settings request
 * @param {Object} data - Decrypted request data
 * @returns {Object} - Response to encrypt
 */
async function handleSettingsRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;

  logToFile('Handling settings request', {
    action,
    screen,
    hasFlowToken: !!flow_token,
    screenDataKeys: screenData ? Object.keys(screenData) : []
  });

  if (action === 'ping') {
    return FlowEncryptionService.handlePing();
  }

  // Flow token format: "userId:settings:timestamp"
  const userId = (flow_token || '').split(':')[0];

  if (action === 'INIT' || action === 'init') {
    return await handleSettingsInit(userId);
  }
  if (action === 'data_exchange') {
    return await handleSettingsDataExchange(userId, screen, screenData, flow_token);
  }
  if (action === 'BACK') {
    return await handleSettingsBack(userId, screen, flow_token);
  }

  logToFile('Unknown settings flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

// ============================================================
// STATUS FLOW ENDPOINT — cross-feature snapshot + cancel
// ============================================================

router.post('/status', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'status' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => await handleStatusFlowRequest(decryptedData)
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', { endpoint: 'status', error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

async function handleStatusFlowRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;
  logToFile('Handling status flow request', {
    action, screen, hasFlowToken: !!flow_token,
    screenDataKeys: screenData ? Object.keys(screenData) : []
  });

  if (action === 'ping') return FlowEncryptionService.handlePing();
  const userId = (flow_token || '').split(':')[0];

  if (action === 'INIT' || action === 'init') return await handleStatusFlowInit(userId, flow_token);
  if (action === 'data_exchange')             return await handleStatusFlowDataExchange(userId, screen, screenData, flow_token);
  if (action === 'BACK')                      return await handleStatusFlowBack(userId, screen, flow_token);

  logToFile('Unknown status flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

// ============================================================
// QUIZ FLOW (Quiz Manager — view/cancel active quizzes, send a new one)
// ============================================================

router.post('/quiz', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'quiz' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => await handleQuizFlowRequest(decryptedData)
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', { endpoint: 'quiz', error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

async function handleQuizFlowRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;
  logToFile('Handling quiz flow request', {
    action, screen, hasFlowToken: !!flow_token,
    screenDataKeys: screenData ? Object.keys(screenData) : []
  });

  if (action === 'ping') return FlowEncryptionService.handlePing();
  const userId = (flow_token || '').split(':')[0];

  if (action === 'INIT' || action === 'init') return await handleQuizFlowInit(userId, flow_token);
  if (action === 'data_exchange')             return await handleQuizFlowDataExchange(userId, screen, screenData, flow_token);
  if (action === 'BACK')                      return await handleQuizFlowBack(userId, screen, flow_token);

  logToFile('Unknown quiz flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

// ============================================================
// TRAINING MULTI-ANSWER QUESTION (select-all-that-apply CheckboxGroup)
// ============================================================

router.post('/training-msq', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'training-msq' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => await handleTrainingMsqRequest(decryptedData)
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', { endpoint: 'training-msq', error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

async function handleTrainingMsqRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;
  logToFile('Handling training multi-answer flow request', {
    action, screen, hasFlowToken: !!flow_token,
    screenDataKeys: screenData ? Object.keys(screenData) : []
  });

  if (action === 'ping') return FlowEncryptionService.handlePing();
  const userId = (flow_token || '').split(':')[0];

  if (action === 'INIT' || action === 'init') return await handleTrainingMsqInit(userId, flow_token);
  if (action === 'data_exchange')             return await handleTrainingMsqDataExchange(userId, screen, screenData, flow_token);
  if (action === 'BACK')                      return await handleTrainingMsqBack(userId, screen, flow_token);

  logToFile('Unknown training multi-answer flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

// ============================================================
// TEACHER TRAINING FLOW — home screen + level detail with badges
// ============================================================

router.post('/teacher-training', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'teacher-training' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => await handleTeacherTrainingRequest(decryptedData)
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', { endpoint: 'teacher-training', error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

async function handleTeacherTrainingRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;
  logToFile('Handling teacher training flow request', {
    action, screen, hasFlowToken: !!flow_token,
    screenDataKeys: screenData ? Object.keys(screenData) : []
  });

  if (action === 'ping') return FlowEncryptionService.handlePing();
  const userId = (flow_token || '').split(':')[0];

  if (action === 'INIT' || action === 'init') return await handleTeacherTrainingInit(userId, flow_token);
  if (action === 'data_exchange')             return await handleTeacherTrainingDataExchange(userId, screen, screenData, flow_token);
  if (action === 'BACK')                      return await handleTeacherTrainingBack(userId, screen, flow_token);

  logToFile('Unknown teacher training flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

// ============================================================
// EXAM GENERATOR FLOW — 3-screen: type → grade/subject/lang → chapters
// See docs/migration/05-exam-generator.md
// ============================================================

router.post('/exam-generator', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'exam-generator' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => await handleExamGeneratorRequest(decryptedData)
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', { endpoint: 'exam-generator', error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

async function handleExamGeneratorRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;
  logToFile('Handling exam generator flow request', {
    action, screen, hasFlowToken: !!flow_token,
    screenDataKeys: screenData ? Object.keys(screenData) : []
  });

  if (action === 'ping') return FlowEncryptionService.handlePing();
  const userId = (flow_token || '').split(':')[0];

  if (action === 'INIT' || action === 'init') return await handleExamGeneratorInit(userId, flow_token);
  if (action === 'data_exchange')             return await handleExamGeneratorDataExchange(userId, screen, screenData, flow_token);
  if (action === 'BACK')                      return await handleExamGeneratorBack(userId, screen, flow_token);

  logToFile('Unknown exam generator flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

// ============================================================
// ASSESSMENT GENERATOR FLOW — 2-screen: spec → questions.
// Backend submits to external UG_EG service (assessment-gen-client.service);
// result lands on POST /webhooks/assessment-generator.
// ============================================================

router.post('/assessment-gen', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'assessment-gen' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => await handleAssessmentGenRequest(decryptedData)
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Flow endpoint error', { endpoint: 'assessment-gen', error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

async function handleAssessmentGenRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;
  logToFile('Handling assessment-gen flow request', {
    action, screen, hasFlowToken: !!flow_token,
    screenDataKeys: screenData ? Object.keys(screenData) : []
  });

  if (action === 'ping') return FlowEncryptionService.handlePing();
  const userId = (flow_token || '').split(':')[0];

  if (action === 'INIT' || action === 'init') return await handleAssessmentGenInit(userId, flow_token);
  if (action === 'data_exchange')             return await handleAssessmentGenDataExchange(userId, screen, screenData, flow_token);
  if (action === 'BACK')                      return await handleAssessmentGenBack(userId, flow_token);

  logToFile('Unknown assessment-gen flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

// ============================================================
// STUDENT VIDEOS FLOW ENDPOINT — browse the library + deliver to chat
// ============================================================

router.post('/student-videos', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'student-videos' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => handleStudentVideosFlow(decryptedData)
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Student Videos flow endpoint error', {
      endpoint: 'student-videos',
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message });
  }
});

async function handleStudentVideosFlow(data) {
  const { action, flow_token, screen, data: screenData } = data;
  logToFile('Handling Student Videos flow', { action, screen, hasFlowToken: !!flow_token });
  if (action === 'ping') return FlowEncryptionService.handlePing();
  if (action === 'INIT' || action === 'init') return await handleStudentVideosInit(flow_token);
  if (action === 'data_exchange')             return await handleStudentVideosDataExchange(flow_token, screen, screenData);
  if (action === 'BACK')                      return await handleStudentVideosBack(flow_token, screen);
  logToFile('Unknown student-videos flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

// ============================================================
// HOMEWORK REQUEST FLOW ENDPOINT — browse chapters + enqueue bundle jobs
// ============================================================

router.post('/homework-request', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'homework-request' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => handleHomeworkFlow(decryptedData)
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Homework flow endpoint error', {
      endpoint: 'homework-request',
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message });
  }
});

async function handleHomeworkFlow(data) {
  const { action, flow_token, screen, data: screenData } = data;
  logToFile('Handling Homework flow', { action, screen, hasFlowToken: !!flow_token });
  if (action === 'ping') return FlowEncryptionService.handlePing();
  if (action === 'INIT' || action === 'init') return await handleHomeworkInit(flow_token);
  if (action === 'data_exchange')             return await handleHomeworkDataExchange(flow_token, screen, screenData);
  if (action === 'BACK')                      return await handleHomeworkBack(flow_token, screen);
  logToFile('Unknown homework flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

// ============================================================
// EDIT CLASS FLOW ENDPOINT — roster view / add / remove / edit students
// ============================================================


// ============================================================
// EXAM-CHECKER "CONFIRM STUDENTS" FLOW ENDPOINT
// flow_token IS the exam session id (set by the orchestrator at launch).
// ============================================================

router.post('/exam-confirm-students', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'exam-confirm-students' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => await handleExamConfirmRequest(decryptedData)
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Exam-confirm flow endpoint error', { endpoint: 'exam-confirm-students', error: error.message, stack: error.stack });
    res.status(500).json({ error: error.message });
  }
});

async function handleExamConfirmRequest(data) {
  const { action, flow_token, screen, data: screenData } = data;
  logToFile('Handling exam-confirm request', { action, screen, hasFlowToken: !!flow_token });
  if (action === 'ping') return FlowEncryptionService.handlePing();
  if (action === 'INIT' || action === 'init') return await handleExamConfirmInit(flow_token);
  if (action === 'data_exchange')             return await handleExamConfirmDataExchange(flow_token, screen, screenData);
  if (action === 'BACK')                      return await handleExamConfirmBack(flow_token);
  logToFile('Unknown exam-confirm flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

// ============================================================
// PAKISTAN LP FLOW ENDPOINT (FEAT-059) — pick a pre-generated LP by
// Grade → Subject → Chapter and deliver the PDF to chat.
// ============================================================

router.post('/pakistan-lp', async (req, res) => {
  try {
    if (!FlowEncryptionService.isConfigured()) {
      logToFile('Flow encryption not configured', { endpoint: 'pakistan-lp' });
      return res.status(500).json({ error: 'Flow encryption not configured' });
    }
    const encryptedResponse = await FlowEncryptionService.processEncryptedRequest(
      req.body,
      async (decryptedData) => handlePakistanLpFlow(decryptedData)
    );
    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (error) {
    logToFile('Pakistan LP flow endpoint error', {
      endpoint: 'pakistan-lp',
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: error.message });
  }
});

async function handlePakistanLpFlow(data) {
  const { action, flow_token, screen, data: screenData } = data;
  logToFile('Handling Pakistan LP flow', { action, screen, hasFlowToken: !!flow_token });
  if (action === 'ping') return FlowEncryptionService.handlePing();
  if (action === 'INIT' || action === 'init') return await handlePakistanLpInit(flow_token);
  if (action === 'data_exchange')             return await handlePakistanLpDataExchange(flow_token, screen, screenData);
  if (action === 'BACK')                      return await handlePakistanLpBack(flow_token, screen);
  logToFile('Unknown pakistan-lp flow action', { action });
  return FlowEncryptionService.createErrorResponse('Unknown action');
}

module.exports = router;
