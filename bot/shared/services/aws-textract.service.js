const { TextractClient, AnalyzeDocumentCommand } = require('@aws-sdk/client-textract');
const { logToFile } = require('../utils/logger');
const { lazyClient } = require('../utils/lazy-client');
const { envStr } = require('../utils/env');

// AWS Textract is the optional exam-checker OCR fallback (the primary is
// Mistral). Lazy-initialised: the bot can boot without AWS Textract
// credentials; the only call path that needs them is `extractText` itself.
//
// Supports the standard AWS env-var names; falls back to the dedicated
// `AWS_TEXTRACT_*` names if a deployment wants to isolate Textract credentials
// from other AWS-SDK consumers.
//
// Read through `envStr` rather than `process.env` directly: a platform env var is
// delivered verbatim, so a value pasted with quotes keeps them. That is not
// hypothetical here — NIETE ran with `AWS_REGION_TEXTRACT='"ap-southeast-1"'` and
// both AWS_TEXTRACT_* credentials quoted the same way, which made every Textract
// call throw `Region not accepted` and cost 23 teachers their coaching report.
// Note the override pair is what made it possible: `AWS_TEXTRACT_*` shadows a
// perfectly good generic `AWS_*` config, so a bad override is invisible to
// anything checking the generic vars.
const textractRegion = envStr('AWS_REGION_TEXTRACT')
  || envStr('AWS_REGION')
  || 'us-east-1';

const getTextractClient = lazyClient(
  TextractClient,
  // We accept EITHER pair (AWS_TEXTRACT_* or generic AWS_*) — the lazyClient
  // helper checks each listed env var as required. To allow EITHER, normalise
  // first: copy the generic-AWS values into the AWS_TEXTRACT_ slots before
  // calling the SDK constructor.
  [], // checked manually below to support the OR-pair semantics
  () => ({
    region: textractRegion,
    credentials: {
      accessKeyId: envStr('AWS_TEXTRACT_ACCESS_KEY_ID') || envStr('AWS_ACCESS_KEY_ID'),
      secretAccessKey: envStr('AWS_TEXTRACT_SECRET_ACCESS_KEY')
        || envStr('AWS_SECRET_ACCESS_KEY'),
    },
  })
);

function assertTextractCredentialsPresent() {
  // Same `envStr` reads as the client construction above. Using raw `process.env`
  // here would let a value of `""` (quotes and nothing else) pass as "present"
  // while the SDK receives `undefined` — a check that disagrees with the thing it
  // is guarding produces the most confusing class of error report.
  const hasKey = envStr('AWS_TEXTRACT_ACCESS_KEY_ID') || envStr('AWS_ACCESS_KEY_ID');
  const hasSecret = envStr('AWS_TEXTRACT_SECRET_ACCESS_KEY') || envStr('AWS_SECRET_ACCESS_KEY');
  if (!hasKey || !hasSecret) {
    throw new Error(
      'AWS Textract cannot be invoked — missing credentials. Set either ' +
      '`AWS_TEXTRACT_ACCESS_KEY_ID`+`AWS_TEXTRACT_SECRET_ACCESS_KEY` OR the ' +
      'generic `AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY` in .env, or use ' +
      'the Mistral OCR primary instead.'
    );
  }
}

class AWSTextractService {
  static async extractText(buffer) {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const command = new AnalyzeDocumentCommand({
          Document: { Bytes: buffer },
          FeatureTypes: ['TABLES', 'FORMS'],
        });

        assertTextractCredentialsPresent();
        const response = await getTextractClient().send(command);

        let extractedText = '';
        let totalConfidence = 0;
        let blockCount = 0;

        for (const block of response.Blocks || []) {
          if (block.BlockType === 'LINE' && block.Text) {
            extractedText += `${block.Text} `;
          }
          if (block.Confidence) {
            totalConfidence += block.Confidence;
            blockCount++;
          }
        }

        const avgConfidence = blockCount > 0 ? totalConfidence / blockCount : 0;
        if (avgConfidence && avgConfidence < 70) {
          logToFile('AWS Textract low confidence', {
            confidence: avgConfidence,
            textLength: extractedText.length,
          });
        }

        return extractedText.trim();
      } catch (error) {
        attempt++;

        if (error.name === 'ThrottlingException' && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          logToFile('AWS Textract throttled, retrying', { attempt, delay });
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        logToFile('AWS Textract extraction failed', { error: error.message });
        throw error;
      }
    }

    throw new Error('Textract failed after retries');
  }
}

// `__textractRegion` is exported for tests only: the region is resolved once at
// module load, and pinning it is what proves a quote-wrapped env var can no
// longer reach the SDK.
module.exports = { AWSTextractService, __textractRegion: textractRegion };

