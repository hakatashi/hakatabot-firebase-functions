import axios from 'axios';
import {Timestamp} from 'firebase-admin/firestore';
import {info as logInfo} from 'firebase-functions/logger';
import {defineString} from 'firebase-functions/params';
import {EXPIRATION_WINDOW_IN_SECONDS, HAKATASHI_TIKTOK_ID} from './const.js';
import {TikTokTokens} from './firestore.js';

const TIKTOK_CLIENT_ID = defineString('TIKTOK_CLIENT_ID');
const TIKTOK_CLIENT_SECRET = defineString('TIKTOK_CLIENT_SECRET');

export interface TikTokTokenResponse {
	access_token: string;
	expires_in: number;
	refresh_token: string;
	scope: string;
	token_type: string;
	open_id: string;
}

export interface TikTokStoredToken extends TikTokTokenResponse {
	expires_at: Date | Timestamp;
}

export const getTikTokAuthUrl = (redirectUri: string, scopes: string[] = ['user.info.basic', 'video.list']): string => {
	const baseUrl = 'https://www.tiktok.com/v2/auth/authorize/';
	const params = new URLSearchParams({
		client_key: TIKTOK_CLIENT_ID.value(),
		scope: scopes.join(','),
		response_type: 'code',
		redirect_uri: redirectUri,
		state: 'tiktok_oauth_state', // You might want to make this dynamic for security
	});

	return `${baseUrl}?${params.toString()}`;
};

export const getTikTokAccessToken = async (code: string, redirectUri: string): Promise<TikTokTokenResponse> => {
	const tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/';

	const data = {
		client_key: TIKTOK_CLIENT_ID.value(),
		client_secret: TIKTOK_CLIENT_SECRET.value(),
		code,
		grant_type: 'authorization_code',
		redirect_uri: redirectUri,
	};

	const response = await axios.post(tokenUrl, data, {
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
	});

	if (response.data.error) {
		throw new Error(`TikTok OAuth error: ${response.data.error_description || response.data.error}`);
	}

	return response.data;
};

export const refreshTikTokToken = async (refreshToken: string): Promise<TikTokTokenResponse> => {
	const tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/';

	const data = {
		client_key: TIKTOK_CLIENT_ID.value(),
		client_secret: TIKTOK_CLIENT_SECRET.value(),
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
	};

	const response = await axios.post(tokenUrl, data, {
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
	});

	if (response.data.error) {
		throw new Error(`TikTok token refresh error: ${response.data.error_description || response.data.error}`);
	}

	return response.data;
};

export const get = async (path: string, params: Record<string, string> = {}, userId: string = HAKATASHI_TIKTOK_ID) => {
	const tokenDoc = await TikTokTokens.doc(userId).get();

	if (!tokenDoc.exists) {
		throw new Error('TikTok token not found for user');
	}

	const tokenData = tokenDoc.data();
	if (!tokenData) {
		throw new Error('TikTok token data is empty');
	}

	const storedToken = tokenData as TikTokStoredToken;
	let currentToken = storedToken;	// Check if token is expired (with buffer time)
	const expiresAt = storedToken.expires_at instanceof Date
		? storedToken.expires_at
		: (storedToken.expires_at as Timestamp).toDate();

	const now = new Date();
	const timeUntilExpiry = (expiresAt.getTime() - now.getTime()) / 1000;

	if (timeUntilExpiry <= EXPIRATION_WINDOW_IN_SECONDS) {
		logInfo('Refreshing TikTok token...');
		const refreshedToken = await refreshTikTokToken(storedToken.refresh_token);

		// Calculate new expiration date
		const newExpiresAt = new Date(Date.now() + refreshedToken.expires_in * 1000);

		const updatedToken: TikTokStoredToken = {
			...refreshedToken,
			expires_at: newExpiresAt,
		};

		await TikTokTokens.doc(userId).set(updatedToken, {merge: true});
		currentToken = updatedToken;
	}

	const url = new URL(`https://open.tiktokapis.com${path}`);

	// Add query parameters
	Object.keys(params).forEach((key) => {
		url.searchParams.append(key, params[key]);
	});

	const response = await axios.get(url.toString(), {
		headers: {
			Authorization: `Bearer ${currentToken.access_token}`,
			'Content-Type': 'application/json',
		},
	});

	return response.data;
};

export const post = async (
	path: string,
	data: Record<string, unknown> = {},
	params: Record<string, string> = {},
	userId: string = HAKATASHI_TIKTOK_ID,
) => {
	const tokenDoc = await TikTokTokens.doc(userId).get();

	if (!tokenDoc.exists) {
		throw new Error('TikTok token not found for user');
	}

	const tokenData = tokenDoc.data();
	if (!tokenData) {
		throw new Error('TikTok token data is empty');
	}

	const storedToken = tokenData as TikTokStoredToken;
	let currentToken = storedToken;

	// Check if token is expired (with buffer time)
	const expiresAt = storedToken.expires_at instanceof Date
		? storedToken.expires_at
		: (storedToken.expires_at as Timestamp).toDate();

	const now = new Date();
	const timeUntilExpiry = (expiresAt.getTime() - now.getTime()) / 1000;

	if (timeUntilExpiry <= EXPIRATION_WINDOW_IN_SECONDS) {
		logInfo('Refreshing TikTok token...');
		const refreshedToken = await refreshTikTokToken(storedToken.refresh_token);

		// Calculate new expiration date
		const newExpiresAt = new Date(Date.now() + refreshedToken.expires_in * 1000);

		const updatedToken: TikTokStoredToken = {
			...refreshedToken,
			expires_at: newExpiresAt,
		};

		await TikTokTokens.doc(userId).set(updatedToken, {merge: true});
		currentToken = updatedToken;
	}

	const url = new URL(`https://open.tiktokapis.com${path}`);

	Object.keys(params).forEach((key) => {
		url.searchParams.append(key, params[key]);
	});

	const response = await axios.post(url.toString(), data, {
		headers: {
			Authorization: `Bearer ${currentToken.access_token}`,
			'Content-Type': 'application/json',
		},
	});

	return response.data;
};
