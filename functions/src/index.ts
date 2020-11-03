import {https, logger, config as getConfig} from 'firebase-functions';
import {google} from 'googleapis';

export * from './slack';

const fitness = google.fitness('v1');

const config = getConfig();

const oauth2Client = new google.auth.OAuth2(
	config.google.client_id,
	config.google.client_secret,
	'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/googleApiOauthCallback',
);

export const authenticateGoogleApi = https.onRequest((request, response) => {
	const url = oauth2Client.generateAuthUrl({
		access_type: 'offline',

		scope: ['https://www.googleapis.com/auth/fitness.activity.read'],
	});
	logger.info(url);
	response.redirect(url);
});

export const googleApiOauthCallback = https.onRequest(async (request, response) => {
	const code = request.query?.code;
	if (!code || typeof code !== 'string') {
		response.sendStatus(400).end();
		return;
	}
	const {tokens} = await oauth2Client.getToken(code);
	oauth2Client.setCredentials(tokens);
	const data = await fitness.users.sessions.list({
		userId: 'me',
		auth: oauth2Client,
	});
	logger.info(data);
	response.send('hoge');
});
