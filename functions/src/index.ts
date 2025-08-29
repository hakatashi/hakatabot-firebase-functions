import assert from 'node:assert';
import {onRequest} from 'firebase-functions/v2/https';
import {google} from 'googleapis';
import {GoogleTokens, FitbitTokens, TikTokTokens, AnimeWatchRecords} from './firestore.js';
import {client as fitbitClient} from './fitbit.js';
import {oauth2Client} from './google.js';
import {getTikTokAuthUrl, getTikTokAccessToken, TikTokStoredToken} from './tiktok.js';

export {slackEvent} from './slack.js';
export * from './crons/index.js';
export * from './api/index.js';

const oauth2 = google.oauth2('v2');

export const authenticateGoogleApi = onRequest((request, response) => {
	const url = oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: [
			'https://www.googleapis.com/auth/photoslibrary',
			'https://www.googleapis.com/auth/userinfo.email',
			'https://www.googleapis.com/auth/userinfo.profile',
			'https://www.googleapis.com/auth/youtube.readonly',
			'https://www.googleapis.com/auth/spreadsheets.readonly',
			'https://www.googleapis.com/auth/calendar',
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

	const authorizationUri = fitbitClient.authorizeURL({
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

	const accessToken = await fitbitClient.getToken({
		code,
		redirect_uri: 'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/fitbitApiOauthCallback',
	});

	assert(typeof accessToken.token.user_id === 'string');
	await FitbitTokens.doc(accessToken.token.user_id).set(accessToken.token, {merge: true});

	response.send('ok');
});

export const authenticateTikTokApi = onRequest((request, response) => {
	let scopes = request.query?.scopes;

	if (scopes === undefined) {
		scopes = ['user.info.stats', 'video.list', 'video.publish'];
	} else if (typeof scopes === 'string') {
		scopes = scopes.split(',');
	} else if (!Array.isArray(scopes)) {
		response.sendStatus(400).end();
		return;
	}

	const redirectUri = 'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/tiktokApiOauthCallback';
	const authorizationUri = getTikTokAuthUrl(redirectUri, scopes.map((scope) => scope.toString()));

	response.redirect(authorizationUri);
});

export const tiktokApiOauthCallback = onRequest(async (request, response) => {
	try {
		const code = request.query?.code;
		const error = request.query?.error;

		if (error) {
			response.status(400).send(`TikTok OAuth error: ${error}`);
			return;
		}

		if (!code || typeof code !== 'string') {
			response.sendStatus(400).end();
			return;
		}

		const redirectUri = 'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/tiktokApiOauthCallback';
		const tokenResponse = await getTikTokAccessToken(code, redirectUri);

		// Calculate expiration date
		const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

		const storedToken: TikTokStoredToken = {
			...tokenResponse,
			expires_at: expiresAt,
		};

		// Use open_id as the document ID for TikTok tokens
		await TikTokTokens.doc(tokenResponse.open_id).set(storedToken, {merge: true});

		response.send('ok');
	} catch (error) {
		console.error('TikTok OAuth callback error:', error);
		response.status(500).send('Failed to process TikTok OAuth callback');
	}
});

export const recordAnimeWatchRecord = onRequest(async (request, response) => {
	if (!request.body || typeof request.body !== 'object') {
		response.sendStatus(400).end();
		return;
	}
	await AnimeWatchRecords.doc(request.body?.partId.toString()).set(request.body, {merge: true});
	response.send('ok');
});
