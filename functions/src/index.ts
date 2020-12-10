import {https, logger, config as getConfig} from 'firebase-functions';
import {google} from 'googleapis';
import {GoogleTokens} from './firestore';

export * from './slack';
export * from './crons';

const config = getConfig();

const oauth2 = google.oauth2('v2');

const oauth2Client = new google.auth.OAuth2(
	config.google.client_id,
	config.google.client_secret,
	'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/googleApiOauthCallback',
);

export const authenticateGoogleApi = https.onRequest((request, response) => {
	logger.info(request.url);
	const url = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: [
			'https://www.googleapis.com/auth/photoslibrary',
			'https://www.googleapis.com/auth/userinfo.email',
			'https://www.googleapis.com/auth/userinfo.profile',
		],
		redirect_uri: 'http://localhost:5001/hakatabot-firebase-functions/us-central1/googleApiOauthCallback',
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
	const data = await oauth2Client.getToken({
		code,
		redirect_uri: 'http://localhost:5001/hakatabot-firebase-functions/us-central1/googleApiOauthCallback',
	});
	const {tokens} = data;
	oauth2Client.setCredentials(tokens);

	const tokenInfo = await oauth2.tokeninfo({auth: oauth2Client});
	if (!tokenInfo.data || !tokenInfo.data.email) {
		response.sendStatus(500).end();
		return;
	}

	await GoogleTokens.doc(tokenInfo.data.email).set(tokens);

	response.send('ok');
});
