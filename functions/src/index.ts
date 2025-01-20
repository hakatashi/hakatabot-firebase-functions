import assert from 'node:assert';
import {onRequest} from 'firebase-functions/v2/https';
import {google} from 'googleapis';
import {GoogleTokens, FitbitTokens, AnimeWatchRecords} from './firestore.js';
import {getClient as getFitbitClient} from './fitbit.js';
import {getClient as getGoogleClient} from './google.js';

export {slackEvent} from './slack.js';
export * from './crons/index.js';
export * from './api/index.js';

const oauth2 = google.oauth2('v2');

export const authenticateGoogleApi = onRequest((request, response) => {
	const googleClient = getGoogleClient();
	const url = googleClient.generateAuthUrl({
		access_type: 'offline',
		scope: [
			'https://www.googleapis.com/auth/photoslibrary',
			'https://www.googleapis.com/auth/userinfo.email',
			'https://www.googleapis.com/auth/userinfo.profile',
			'https://www.googleapis.com/auth/youtube.readonly',
			'https://www.googleapis.com/auth/spreadsheets.readonly',
		],
	});
	response.redirect(url);
});

export const googleApiOauthCallback = onRequest(async (request, response) => {
	const code = request.query?.code;
	if (!code || typeof code !== 'string') {
		response.sendStatus(400).end();
		return;
	}
	const googleClient = getGoogleClient();
	const {tokens} = await googleClient.getToken(code);

	googleClient.setCredentials(tokens);

	const tokenInfo = await oauth2.tokeninfo({auth: googleClient});
	if (!tokenInfo.data || !tokenInfo.data.email) {
		response.sendStatus(500).end();
		return;
	}

	await GoogleTokens.doc(tokenInfo.data.email).set(tokens, {merge: true});

	response.send('ok');
});

export const authenticateFitbitApi = onRequest((request, response) => {
	let scopes = request.query?.scopes;

	if (scopes === undefined) {
		scopes = ['sleep', 'settings', 'oxygen_saturation', 'respiratory_rate', 'profile', 'social', 'activity', 'weight', 'heartrate', 'nutrition', 'location'];
	} else if (typeof scopes === 'string') {
		scopes = scopes.split(',');
	} else if (!Array.isArray(scopes)) {
		response.sendStatus(400).end();
		return;
	}

	const authorizationUri = getFitbitClient().authorizeURL({
		redirect_uri: 'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/fitbitApiOauthCallback',
		scope: scopes.map((scope) => scope.toString()),
	});

	response.redirect(authorizationUri);
});

export const fitbitApiOauthCallback = onRequest(async (request, response) => {
	const code = request.query?.code;
	if (!code || typeof code !== 'string') {
		response.sendStatus(400).end();
		return;
	}

	const accessToken = await getFitbitClient().getToken({
		code,
		redirect_uri: 'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/fitbitApiOauthCallback',
	});

	assert(typeof accessToken.token.user_id === 'string');
	await FitbitTokens.doc(accessToken.token.user_id).set(accessToken.token, {merge: true});

	response.send('ok');
});

export const recordAnimeWatchRecord = onRequest(async (request, response) => {
	if (!request.body || typeof request.body !== 'object') {
		response.sendStatus(400).end();
		return;
	}
	await AnimeWatchRecords.doc(request.body?.partId.toString()).set(request.body, {merge: true});
	response.send('ok');
});
