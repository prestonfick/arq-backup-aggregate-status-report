/**
 * @license
 * Copyright 2020 Preston Fick
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const cliProgress = require('cli-progress');
const nodemailer = require('nodemailer');
const cron = require("node-cron");

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';
const ARQ_BACKUP_DATA_PATH = 'arq-backup-status.json';

var config = require('./config.json');

// Hold current date
let today = new Date;

// Useful time objects
const secondMs = 1000;
const minuteMs = 60 * secondMs;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;
const weeksMs = 7 * dayMs;

// Main backup object that will store the previous backup status, and update for
// the new backup status. This object gets written to arq-backup-status.json.
var arqBackupStatusObject = {
  lastBackupStatusDate: null,
  backupPlanMap: new Map(),
  ignoreList: []
};

// Setup a cron job to run this on the schedule defined in config.json
console.log('Creating schedule for arq-email-notification-status-report - cron(' + config.cronScheduleString + ')');
cron.schedule(config.cronScheduleString, function() {
  setTimeout(arqEmailNotificationStatusReportService);
}, null, true);

// Run for the first time to seed the json file
console.log('Explicit start of first run');
arqEmailNotificationStatusReportService();

// Load previous backup status record from a local file, if it exists, if not create it
function arqEmailNotificationStatusReportService() {
  try {
    const arqBackupStatusString = fs.readFileSync(ARQ_BACKUP_DATA_PATH);
    arqBackupStatusObject = JSON.parse(arqBackupStatusString);
    arqBackupStatusObject.backupPlanMap = new Map(arqBackupStatusObject.backupPlanMap);
    if (!arqBackupStatusObject.ignoreList) {
      arqBackupStatusObject.ignoreList = [];
    }
  } catch (err) {
    console.log('Error loading backup status file:', err);
    console.log(ARQ_BACKUP_DATA_PATH + ' will be created.')
  }

  // Load client secrets from a local file
  fs.readFile(CREDENTIALS_PATH, (err, content) => {
    if (err) return console.log('Error loading client secret file:', err);
    // Authorize a client with credentials, then call the Gmail API.
    authorize(JSON.parse(content), startArqBackupMailCheck);
  });
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * Start the bakup mail check using the auth, this will kick off message parsing
 * to create the updated status report.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 */
function startArqBackupMailCheck(auth) {
  console.log('Starting Arq Backup Mail Check');
  today = new Date();
  let labelSearchString = 'label:' + config.arqStatusMailLabel;
  if (arqBackupStatusObject.lastBackupStatusDate === null) {
    console.log('First Backup, getting all existing Arq Backup status mails');
  } else {
    const lastStatusDate = new Date(arqBackupStatusObject.lastBackupStatusDate);
    labelSearchString += ' after:' + lastStatusDate.toLocaleDateString("en-US");
    labelSearchString += ' before:' + today.toLocaleDateString("en-US");
  }
  console.log('Getting Arq Backup status mails using filter: ' + labelSearchString);
  getMessagesFromQuery(auth, labelSearchString, updateArqBackupFromMessages);
}

/**
 * Retrieve Messages in user's mailbox matching query.
 * @param  {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param  {String} query String used to filter the Messages listed.
 * @param  {Function} callback Function to call when the request is complete.
 */
function getMessagesFromQuery(auth, query, callback) {
  const gmail = google.gmail({version: 'v1', auth});
  var getPageOfMessages = function(request, result) {
    return request.then(function(resp) {
      result = result.concat(resp.data.messages);
      var nextPageToken = resp.data.nextPageToken;
      if (nextPageToken) {
        //console.log('Making another request');
        request = gmail.users.messages.list({
          'userId': 'me',
          'pageToken': nextPageToken,
          'q': query
        });
        getPageOfMessages(request, result);
      } else {
        callback(auth, result);
      }
    });
  };
  var initialRequest = gmail.users.messages.list({
    'userId': 'me',
    'q': query
  });
  getPageOfMessages(initialRequest, []);
}

function updateArqBackupFromMessages(auth, messages){
  let progressBar = {};
  const gmail = google.gmail({version: 'v1', auth});
  var getMessage = function(messageIndex, result) {
    const messageId = messages[messageIndex].id;
    var request = gmail.users.messages.get({
      'userId': 'me',
      'id': messageId, 
      'format': 'full'
    });
    return request.then(function(resp) {
      result = result.concat(resp.data);
      messageIndex += 1;
      //console.log(`- ${resp.data.id} - ${resp.data.internalDate} - ${resp.data.snippet}`);
      if (messageIndex < messages.length) {
        progressBar.increment();
        getMessage(messageIndex, result);
      } else {
        progressBar.stop();
        console.log('Email list complete');
        processArqBackupMessageEmails(result);
      }
    })
    .catch(function(error) {
      console.log(error);
    });
  }
  if (messages.length && (messages[0] != undefined)) {
    console.log('Starting to get emails from message list, message count: ' + messages.length.toString());
    progressBar = new cliProgress.SingleBar({
      format: 'Gmail Query Progress |' + '{bar}' + '| {percentage}% || {value}/{total} Emails',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });
    // initialize the bar - defining payload token "speed" with the default value "N/A"
    progressBar.start(messages.length, 1);
    getMessage(0, []);
  } else {
    console.log('No messages found.');
    processArqBackupMessageEmails();
  }
}

function processArqBackupMessageEmails(emailMessages) {
  if (emailMessages != undefined)
  {
    emailMessages.forEach(function(emailMessage) {
      const backupMailText = getEmailMessageBodyPlaintext(emailMessage);
      const backupPlanName = getArqBackupSectionValueFromBody('Backup Plan:', backupMailText);
      const backupPlanDate = new Date(getArqBackupSectionValueFromBody('End Time:', backupMailText));
      const backupPlanErrors = parseInt(getArqBackupSectionValueFromBody('Errors:', backupMailText), 10);
      if (arqBackupStatusObject.backupPlanMap.has(backupPlanName)) {
        const backupPlanObject = arqBackupStatusObject.backupPlanMap.get(backupPlanName);
        const previousDate = new Date(backupPlanObject.dateString);
        if (previousDate.getTime() < backupPlanDate.getTime()) {
          backupPlanObject.dateString = backupPlanDate.toISOString();
          backupPlanObject.mostRecentErrors = backupPlanErrors;
        }
        backupPlanObject.errors += backupPlanErrors;
        backupPlanObject.totalBackups++;
      } else {
        const backupPlanObject = {
          "totalBackups": 1,
          "daysToWarn": config.daysToWarn,
          "daysToError": config.daysToError,
          "dateString": backupPlanDate.toISOString(),
          "errors": backupPlanErrors,
          "mostRecentErrors": backupPlanErrors,
        }
        arqBackupStatusObject.backupPlanMap.set(backupPlanName, backupPlanObject);
      }
    });
  }

  // We will keep track of backup status for this run here
  const backupStatus = {
    errors: 0,
    warnings: 0,
    successes: 0,
    totalBackups: 0,
    totalIgnoredBackups: 0
  };

  // This will hold the entire HTML email that will get sent as the status report body
  let htmlEmailStatusString = '';

  // Create a linked backup status string for each of the backup objects
  arqBackupStatusObject.backupPlanMap.forEach(function(backupPlanObject, backupPlanItem) {
    const lastBackupDate = new Date(backupPlanObject.dateString);
    let backupStatusString = '<b>' + backupPlanItem + '</b><br>';
    backupStatusString += '<ul>';
    const timeSinceLastBackup = today - lastBackupDate;
    const lastBackupDays = timeSinceLastBackup / dayMs;
    if (timeSinceLastBackup >= (weeksMs * 2)) {
      backupStatusString += '<li style="color:red;">Last Backup: ';
    } else {
      backupStatusString += '<li>Last Backup: ';
    }
    if (lastBackupDays < 1)
    {
      const lastBackupHours = timeSinceLastBackup / hourMs;
      if (lastBackupHours < 1) {
        const lastBackupMinutes = timeSinceLastBackup / minuteMs;
        backupStatusString += lastBackupMinutes.toFixed(1) + ' minutes ago';
      } else {
        backupStatusString += lastBackupHours.toFixed(1) + ' hours ago';
      }
    } else {
      backupStatusString += lastBackupDays.toFixed(1) + ' days ago';
    }
    backupStatusString += '</li>';
    backupStatusString += '<li>Last Backup Date: ' + lastBackupDate.toDateString() + '</li>';
    if (backupPlanObject.mostRecentErrors > 0) {
      backupStatusString += '<li style="color:red;">Most recent errors: ';
    } else {
      backupStatusString += '<li>Most recent errors: ';
    }
    backupStatusString += backupPlanObject.mostRecentErrors.toString() + '</li>';
    backupStatusString += '<li>Total Errors over time: ' + backupPlanObject.errors.toString() + '</li>';
    backupStatusString += '<li>Total Backups over time: ' + backupPlanObject.totalBackups.toString() + '</li></ul>';
    // Show a red status if backups haven't occurred in the error threshold, or if there are any recent errors
    // Show a yellow status if the backups haven't occurred in the warning threshold
    // Show a green status otherwise for successful backup status
    backupStatus.totalBackups++;
    let backupStatusHealthEmoji = '';
    if (arqBackupStatusObject.ignoreList && arqBackupStatusObject.ignoreList.includes(backupPlanItem)) {
        backupStatus.totalIgnoredBackups++;
        backupStatusHealthEmoji = '〰️';
    } else if (timeSinceLastBackup >= (backupPlanObject.daysToError * dayMs) ||
        (backupPlanObject.mostRecentErrors != 0)) {
          backupStatus.errors++;
          backupStatusHealthEmoji = '❌';
    } else if (timeSinceLastBackup >= (backupPlanObject.daysToWarn * dayMs)) {
      backupStatus.warnings++;
      backupStatusHealthEmoji = '⚠️';
    } else {
      backupStatus.successes++;
      backupStatusHealthEmoji = '✅';
    }
    backupStatusString = backupStatusHealthEmoji + backupStatusString;

    // Add this backup status string as an item in the entire HTML status string, followed by a rule
    htmlEmailStatusString += backupStatusString + '<hr>';
  });

  const imageList = [{
    filename: 'arq-icon.png',
    path: './images/arq-icon.png',
    cid: 'arq-icon.png'
  }];

  // Create a status overview based on the backup data
  let statusOverview = '<b>Overview</b>';
  statusOverview += '</ul><li>Total Backups: ' + backupStatus.totalBackups + '</li>';
  let statusHealthEmoji = '✅ ';
  if (backupStatus.warnings > 0) {
    statusOverview += '<li>Warnings: ' + backupStatus.warnings + '</li>';
    statusHealthEmoji = '⚠️ ';
  }
  if (backupStatus.errors > 0) {
    statusOverview += '<li>Errors: ' + backupStatus.errors + '</li>';
    statusHealthEmoji = '❌ ';
  }
  if (backupStatus.totalIgnoredBackups > 0) {
    statusOverview += '<li>Total Ignored Backups: ' + backupStatus.totalIgnoredBackups + '</li>';
  }
  statusOverview += '</ul></b><br><b>Individual Backup Information</b><hr>';
  statusOverview = '<h1>' + statusHealthEmoji + '</h1>' + statusOverview;

  // Stitch together the status overview with the existing status string
  htmlEmailStatusString = statusOverview + htmlEmailStatusString;
  htmlEmailStatusString = 'Created: ' + today.toDateString() + '<br>' + htmlEmailStatusString;
  htmlEmailStatusString = '<img src="cid:arq-icon.png"/><br><br><b>Arq Backup Status Report</b><br>' + htmlEmailStatusString;

  htmlEmailStatusString += '<i>Report provided by arq-backup-aggregate-status-report</i>';

  //console.log(htmlEmailStatusString);

  // Finally, set our latest backup date to now
  arqBackupStatusObject.lastBackupStatusDate = today.toISOString();

  // Perform a bit of separation here to properly write out the Map object
  let arqBackupStatusObjectString = '{';
  arqBackupStatusObjectString += '"lastBackupStatusDate":' + JSON.stringify(arqBackupStatusObject.lastBackupStatusDate) + ',';
  arqBackupStatusObjectString += '"backupPlanMap":' + JSON.stringify([...arqBackupStatusObject.backupPlanMap]) + ',';
  arqBackupStatusObjectString += '"ignoreList":' + JSON.stringify(arqBackupStatusObject.ignoreList);
  arqBackupStatusObjectString += '}';

  fs.writeFile(ARQ_BACKUP_DATA_PATH, arqBackupStatusObjectString, (err) => {
    if (err) return console.log('Error updating backup status file:', err);
    console.log('Updated backup status file: ' + ARQ_BACKUP_DATA_PATH);
  });
  
  //TODO - separate out plaintext from HTML, for now HTML is sent for both
  sendArqBackupStatusEmail(htmlEmailStatusString, htmlEmailStatusString, imageList, statusHealthEmoji);
}

function getEmailMessageBodyPlaintext(emailMessage) {
  const mimeParts = emailMessage.payload.parts;
  if (mimeParts) {
    for (const i = 0; i < mimeParts.length; i++) {
      if (mimeParts[i].mimeType == 'text/plain') {
        const bodyPlainTextString = Buffer.from(mimeParts[i].body.data, 'base64').toString();
        return bodyPlainTextString;
      }
    }
  } else if (emailMessage.payload.body) {
    const bodyHtmlTextString = Buffer.from(emailMessage.payload.body.data, 'base64').toString();
    const bodyPlainTextString = bodyHtmlTextString.replace(/(<([^>]+)>)/g, "\n");
    return bodyPlainTextString;
  }
}

function getArqBackupSectionValueFromBody(sectionTag, bodyString) {
  // Trim at the end (again) to handle cross platform strings
  return bodyString.substring(bodyString.search(sectionTag) + sectionTag.length, bodyString.length).trim().split('\n')[0].trim();
}

function sendArqBackupStatusEmail(htmlMailBody, textMailBody, imageList, healthEmoji) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.arqStatusSenderEmail,
      pass: config.arqStatusSenderPassword
    }
  });

  const mailOptions = {
    from: '"Arq Backup" <' + config.arqStatusSenderEmail + '>',
    to: config.arqStatusRecipientEmail,
    subject: healthEmoji + 'Arq Backup Status Report',
    text: textMailBody,
    html: htmlMailBody,
    attachments: imageList
  };

  transporter.sendMail(mailOptions, function(error, info){
    if (error) {
      console.log(error);
    } else {
      console.log('Arq Backup Status Email sent: ' + info.response);
    }
  });
}
