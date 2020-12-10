import {config as getConfig, logger} from 'firebase-functions';
import {google} from 'googleapis';
import {GoogleTokens} from './firestore';

const config = getConfig();

const oauth2 = google.oauth2('v2');

export const oauth2Client = new google.auth.OAuth2(
	config.google.client_id,
	config.google.client_secret,
	'https://us-central1-hakatabot-firebase-functions.cloudfunctions.net/googleApiOauthCallback',
);

oauth2Client.on('tokens', async (tokens) => {
	logger.info('Google token was updated');
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
