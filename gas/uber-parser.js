/**
 * EcoFinance — Uber Receipt Email Parser
 * Runs as a Google Apps Script triggered by time or manually.
 * 
 * Setup:
 * 1. Create a new Google Apps Script project at script.google.com
 * 2. Paste this code
 * 3. Set Script Properties: GEMINI_API_KEY, WEBHOOK_URL, API_SECRET_KEY
 * 4. Create a time-driven trigger (every 15 minutes or hourly)
 */

function processUberEmails() {
  const props = PropertiesService.getScriptProperties();
  const GEMINI_API_KEY = props.getProperty('GEMINI_API_KEY');
  const WEBHOOK_URL = props.getProperty('WEBHOOK_URL');
  const API_SECRET_KEY = props.getProperty('API_SECRET_KEY');

  if (!GEMINI_API_KEY || !WEBHOOK_URL || !API_SECRET_KEY) {
    Logger.log("Missing Script Properties. Please configure GEMINI_API_KEY, WEBHOOK_URL, API_SECRET_KEY.");
    return;
  }

  // 1. Search Gmail for unread Uber receipts
  const threads = GmailApp.search('from:noreply@uber.com subject:"Sua viagem de" is:unread', 0, 10);
  
  if (threads.length === 0) {
    Logger.log("No new Uber receipts found.");
    return;
  }

  for (let i = 0; i < threads.length; i++) {
    const messages = threads[i].getMessages();
    // Get the last message in the thread (most recent)
    const message = messages[messages.length - 1];
    
    if (!message.isUnread()) continue;

    const htmlBody = message.getBody();
    Logger.log(`Processing email: ${message.getSubject()}`);

    try {
      const tripData = parseWithGemini(htmlBody, GEMINI_API_KEY);
      
      if (tripData && tripData.valor && tripData.data_hora) {
        const success = sendToWebhook(tripData, WEBHOOK_URL, API_SECRET_KEY);
        if (success) {
          message.markRead(); // Only mark as read if successfully processed and sent
          Logger.log(`Successfully processed and marked as read.`);
        } else {
          Logger.log(`Failed to send webhook. Left as unread.`);
        }
      } else {
        Logger.log(`Failed to parse necessary fields from Gemini response: ${JSON.stringify(tripData)}`);
      }
    } catch (e) {
      Logger.log(`Error processing message ${message.getId()}: ${e.toString()}`);
    }
  }
}

function parseWithGemini(htmlBody, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const systemInstruction = `You are a data extractor parsing Uber receipt emails in Portuguese. 
Extract the total value (valor), the exact date and time of the trip (data_hora) in ISO 8601 format, the starting address (endereco_partida), and the destination address (endereco_destino).
Return ONLY a valid JSON object matching the requested schema.`;

  const payload = {
    contents: [
      {
        parts: [
          { text: "Here is the raw HTML of the Uber receipt email. Extract the data.\n\n" + htmlBody }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        { text: systemInstruction }
      ]
    },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          valor: { type: "NUMBER", description: "Total value of the trip in BRL. E.g., 25.50" },
          data_hora: { type: "STRING", description: "Date and time in ISO 8601 format." },
          endereco_partida: { type: "STRING", description: "Full starting address." },
          endereco_destino: { type: "STRING", description: "Full destination address." }
        },
        required: ["valor", "data_hora", "endereco_partida", "endereco_destino"]
      }
    }
  };

  const options = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(endpoint, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error(`Gemini API Error: ${responseCode} - ${responseText}`);
  }

  const json = JSON.parse(responseText);
  
  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0]) {
    const resultText = json.candidates[0].content.parts[0].text;
    return JSON.parse(resultText);
  } else {
    throw new Error(`Unexpected Gemini response format: ${responseText}`);
  }
}

function sendToWebhook(tripData, webhookUrl, secretKey) {
  const endpoint = `${webhookUrl}/api/transactions/uber-webhook`;
  
  const options = {
    method: "POST",
    contentType: "application/json",
    headers: {
      "x-api-secret-key": secretKey
    },
    payload: JSON.stringify(tripData),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(endpoint, options);
    const responseCode = response.getResponseCode();
    
    if (responseCode >= 200 && responseCode < 300) {
      return true;
    } else {
      Logger.log(`Webhook returned error: ${responseCode} - ${response.getContentText()}`);
      return false;
    }
  } catch (e) {
    Logger.log(`Webhook network error: ${e.toString()}`);
    return false;
  }
}

// Helper to manually create the trigger
function createTimeTrigger() {
  // Clear existing triggers first
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  
  ScriptApp.newTrigger('processUberEmails')
    .timeBased()
    .everyMinutes(15)
    .create();
    
  Logger.log("Trigger created successfully.");
}
