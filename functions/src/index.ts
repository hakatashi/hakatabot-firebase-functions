import {https} from 'firebase-functions';
import {google} from 'googleapis';
import {GoogleTokens} from './firestore';
import {oauth2Client} from './google';

export * from './slack';
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
