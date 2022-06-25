import {https} from 'firebase-functions';
import {google} from 'googleapis';
import {HAKATASHI_EMAIL} from './const';
import {GoogleTokens, FitbitTokens} from './firestore';
import {client as fitbitClient} from './fitbit';
import {oauth2Client} from './google';

export {slackEvent} from './slack';
export * from './crons';

const oauth2 = google.oauth2('v2');

export const authenticateGoogleApi = https.onRequest((request, response) => {
	const url = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: [
			'https://www.googleapis.com/auth/photoslibrary',
			'https://www.googleapis.com/auth/userinfo.email',
			'https://www.googleapis.com/auth/userinfo.profile',
		],
	});
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

	const tokenInfo = await oauth2.tokeninfo({auth: oauth2Client});
	if (!tokenInfo.data || !tokenInfo.data.email) {
		response.sendStatus(500).end();
		return;
	}

	await GoogleTokens.doc(tokenInfo.data.email).set(tokens, {merge: true});

	response.send('ok');
});

export const authenticateFitbitApi = https.onRequest((request, response) => {
	const authorizationUri = fitbitClient.authorizeURL({
		redirect_uri: 'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/fitbitApiOauthCallback',
		scope: ['sleep', 'settings', 'oxygen_saturation', 'respiratory_rate', 'profile', 'social', 'activity', 'weight', 'heartrate', 'nutrition', 'location'],
	});

	response.redirect(authorizationUri);
});

export const fitbitApiOauthCallback = https.onRequest(async (request, response) => {
	const code = request.query?.code;
	if (!code || typeof code !== 'string') {
		response.sendStatus(400).end();
		return;
	}

	const accessToken = await fitbitClient.getToken({
		code,
		redirect_uri: 'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/fitbitApiOauthCallback',
	});

	await FitbitTokens.doc(HAKATASHI_EMAIL).set(accessToken.token, {merge: true});

	response.send('ok');
});
