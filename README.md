# Arq Backup Aggregate Status Report

I use [Arq Backup](https://www.arqbackup.com/) with a family pack license to backup multiple computers and servers within my home. These backups are setup to send a notification on every backup to my Gmail account (in most cases, every hour). This generates a LOT of emails and it's difficult to really check and ensure that all backups are working well, especially for machines I don't see the local status messages on.

This [Node.js application](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) is a solution to aggregate all of those email notifications and generate a weekly status report on the health of those backups over time, in an email that looks like this:

<img src="https://raw.githubusercontent.com/prestonfick/arq-backup-aggregate-status-report/master/images/sample-arq-status-report.png" width="375">

This application will use the Gmail API to go look at all your emails from Arq Backup, parses and creates a small JSON log of the current status. Out of the box it is set to go get an update on this every Sunday. All the new information is placed in to a status email and sent out using Gmail via an app password (this is similar to how Arq Backup is setup to send your email notifications, and the same password can be used).

## Application Setup

### Arq Backup Notification Email Subject Labeling, and Gmail Filter

This application uses the Gmail API to go read all the [Arq Backup notifications that have been generated by each machine's backup](https://www.arqbackup.com/documentation/pages/email_report.html). It expects all Arq Backup notifications be labeled (and I also suggest archiving them automatically to keep tidy - there's no reason to see these anymore unless you are debugging a backup issue). This requires some configuration to the Arq Backups on each of your machines so the backup notification email subject contains like `[ArqBackup]` that can be filtered and labeled as they arrive in to your Gmail inbox. Once that is setup, [configure Gmail to filter these emails as follows](https://support.google.com/mail/answer/6579?hl=en):

```
Matches: [ArqBackup]
Do this: Skip Inbox, Mark as read, Apply label "ArqBackup"
```

### Setup Gmail API

This application needs dynamic access to your Gmail to read the Arq Backup mails. To obtain credentials to use Google Gmail API, perform the following steps:

#### Project Setup:

- Go to the [Google APIs Dashboard](https://console.developers.google.com/projectselector/apis/dashboard), and click `Create Project`
- Name the project `Arq-Email-Status-Report` and click `Create`
- When the notification shows the project has been created click the `View` link to see the dashboard for the project

#### OAuth Screen Setup:

- On the left menu in `APIs & Services` select `OAuth Consent Screen`
- Choose `External` User Type then click `Create`
- Enter the Application Name `Arq Email Notification Status Report` then click `Save`

#### Enable Gmail API:

- On the left menu in `APIs & Services` select `Dashboard`
- Click the `+ Enable APIs and Services` link
- Search for the Gmail API, then click the `Enable` button
- When the Overview page shows click the `Credentials` menu item on the left
- Click the `+Create Credentials` button and select OAuth Client ID
- Choose `Desktop App` application type, then set the name to `Arq Email Notification Status Report Client`
- When the OAuth Client Created box shows, click `OK`
- Click the download button on the right of the newly created credentials
- Rename the file to `credentials.json` and put it in this project folder

### Setup Gmail App password

A Gmail App Password is used to send the Status Report mail. If your Arq Backups are already set to send the reports to Gmail, then simply use that same App Password here to send the status report. If you don't have an App Password then [setup an App Password for your Gmail account](https://support.google.com/accounts/answer/185833?hl=en). Add your email address and this password to the `config.json` file for the `arqStatusSenderEmail` and `arqStatusSenderPassword` properties respectively.

### Setup Cron Timing

The `config.json` [allows for configuration of when this will run using standard cron notation](https://www.npmjs.com/package/cron#cron-ranges). Out of the box this will run at 4AM every Sunday morning.

### Setup Warning/Error Limits

If any backup has recent errors, this will report an error. The `config.json` allows for configuration of when it will warn, and error, when backups have not occurred. Out of the box it will warn if backups haven't happend in 14 days, and error if backups haven't happened in 30 days.

## Install

To install the application packages, run `npm install`.

## Run

To start the application, run `npm start`.

### OAuth

When running this the first time, it will require OAuth registration, follow the prompts to obtain a token to allow access to Gmail, as configured above. This requires visiting the site dispalyed in your terminal, granting access to your Gmail account, then supplying the token to the CLI input in the terminal. Once this works, a token.json is created next to the application for usage as it runs over time.

## Features

### Ignore Existing Backups

If you have backups that exist as part of your report but stop backing they can be configured to be ignored. Add the full name of the backup string to the `ignoreList` list in the `arq-backup-status.json` file. This will still report the last time backed up but will not affect the report with a warning or error based on the configured limits.