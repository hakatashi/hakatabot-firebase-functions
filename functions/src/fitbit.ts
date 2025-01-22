import axios from 'axios';
import {info as logInfo} from 'firebase-functions/logger';
import {defineString} from 'firebase-functions/params';
import {AuthorizationCode} from 'simple-oauth2';
import {EXPIRATION_WINDOW_IN_SECONDS, HAKATASHI_FITBIT_ID} from './const.js';
import {FitbitTokens} from './firestore.js';

const FITBIT_CLIENT_ID = defineString('FITBIT_CLIENT_ID');
const FITBIT_CLIENT_SECRET = defineString('FITBIT_CLIENT_SECRET');

export const client = new AuthorizationCode({
	client: {
		id: FITBIT_CLIENT_ID.value(),
		secret: FITBIT_CLIENT_SECRET.value(),
	},
	auth: {
		tokenHost: 'https://api.fitbit.com',
		tokenPath: '/oauth2/token',
		authorizeHost: 'https://www.fitbit.com',
		authorizePath: '/oauth2/authorize',
	},
});

export const get = async (path: string, params: any, userId: string = HAKATASHI_FITBIT_ID) => {
	const hakatashiTokensData = await FitbitTokens.doc(userId).get();

	if (!hakatashiTokensData.exists) {
		throw new Error('hakatashi token not found');
	}

	const hakatashiTokens = hakatashiTokensData.data()!;
	hakatashiTokens.expires_at = hakatashiTokens.expires_at.toDate();

	let accessToken = client.createToken(hakatashiTokens as any);

	if (accessToken.expired(EXPIRATION_WINDOW_IN_SECONDS)) {
		logInfo('Refreshing token...');
		accessToken = await accessToken.refresh();
		await FitbitTokens.doc(userId).set(accessToken.token, {merge: true});
	}

	const url = new URL('https://api.fitbit.com/');
	url.pathname = path;

	const res = await axios.get(url.toString(), {
		params,
		headers: {
			Authorization: `Bearer ${accessToken.token.access_token}`,
		},
	});

	return res.data;
};
