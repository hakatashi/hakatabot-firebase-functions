import {info as logInfo} from 'firebase-functions/logger';
import {defineSecret} from 'firebase-functions/params';
import type {OAuth2Client} from 'google-auth-library';
import {google} from 'googleapis';
import {HAKATASHI_EMAIL} from './const.js';
import {GoogleTokens} from './firestore.js';

const GOOGLE_CLIENT_ID = defineSecret('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');

const oauth2 = google.oauth2('v2');
let oauth2Client: OAuth2Client | null = null;

export const getClient = () => {
	if (oauth2Client !== null) {
		return oauth2Client;
	}

	oauth2Client = new google.auth.OAuth2(
		GOOGLE_CLIENT_ID.value(),
		GOOGLE_CLIENT_SECRET.value(),
		'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/googleApiOauthCallback',
	);

	oauth2Client.on('tokens', async (tokens) => {
		logInfo('Google token was updated');
		if (tokens.access_token && tokens.id_token) {
			const tokenInfo = await oauth2.tokeninfo({
				access_token: tokens.access_token,
				id_token: tokens.id_token,
			});
			if (!tokenInfo.data || !tokenInfo.data.email) {
				return;
			}
			await GoogleTokens.doc(tokenInfo.data.email).set(tokens, {merge: true});
		}
	});

	return oauth2Client;
};

export const getGoogleAuth = async () => {
	const hakatashiTokensData = await GoogleTokens.doc(HAKATASHI_EMAIL).get();

	if (!hakatashiTokensData.exists) {
		throw new Error('hakatashi token not found');
	}

	const hakatashiTokens = hakatashiTokensData.data();
	const client = getClient();
	client.setCredentials(hakatashiTokens!);

	return client;
};
