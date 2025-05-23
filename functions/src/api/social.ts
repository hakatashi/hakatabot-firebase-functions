import path from 'node:path';
import qs from 'node:querystring';
import type {File} from '@slack/web-api/dist/types/response/FilesUploadResponse.js';
import axios from 'axios';
import {Timestamp} from 'firebase-admin/firestore';
import {info as logInfo, error as logError} from 'firebase-functions/logger';
import {defineString} from 'firebase-functions/params';
import {onRequest} from 'firebase-functions/v2/https';
import {SANDBOX_ID} from '../const.js';
import {postBluesky, postMastodon, postThreads} from '../crons/lib/social.js';
import {db, States} from '../firestore.js';
import {webClient as slack} from '../slack.js';

const API_TOKEN = defineString('API_TOKEN');

export const updateSocialPost = onRequest(async (request, response) => {
	logInfo('updateSocialPost started');

	if (request.method !== 'POST') {
		response.status(405);
		response.send('Method Not Allowed');
		return;
	}

	const {text, linkToTweet, token, destinations: rawDestinations = ''} = qs.parse(request.rawBody.toString());

	if (token !== API_TOKEN.value()) {
		logError('Invalid token');
		response.status(403);
		response.send('Forbidden');
		return;
	}

	if (typeof text !== 'string' || text.length === 0) {
		logError('Invalid text');
		response.status(400);
		response.send('Bad Request');
		return;
	}

	if (typeof linkToTweet !== 'string' || linkToTweet.length === 0) {
		logError('Invalid linkToTweet');
		response.status(400);
		response.send('Bad Request');
		return;
	}

	if (text.includes('@')) {
		response.status(201);
		response.send('OK');
		return;
	}

	if (typeof rawDestinations !== 'string') {
		logError('Invalid destinations');
		response.status(400);
		response.send('Bad Request');
		return;
	}

	const normalizedDestinations = new Set(rawDestinations.split(',').filter((destination) => (
		['mastodon', 'bluesky', 'threads', 'slack'].includes(destination)
	)));

	const destinations = normalizedDestinations.size === 0 ? ['mastodon', 'bluesky', 'threads', 'slack'] : [...normalizedDestinations];

	logInfo(`text: ${text}`);
	logInfo(`link to tweet: ${linkToTweet}`);
	logInfo(`destinations: ${destinations.join(', ')}`);

	const shortlinks = text.matchAll(/https:\/\/t\.co\/[a-zA-Z0-9]+/g);

	let normalizedText = text.trim();
	let hasImage = false;

	for (const [shortlink] of shortlinks) {
		logInfo(`Resolving shortlink: ${shortlink}`);

		const res = await axios.get(shortlink, {
			maxRedirects: 0,
			validateStatus: (status) => status === 301,
		});

		const location = res.headers.location as string | undefined;

		logInfo(`Resolved shortlink to ${location}`);

		if (location === undefined) {
			logError(`Failed to resolve shortlink: ${shortlink}`);
			continue;
		}

		if (location.startsWith('https://twitter.com/') && location.includes('/photo/')) {
			hasImage = true;
			normalizedText = normalizedText.replace(shortlink, '');
		} else {
			normalizedText = normalizedText.replace(shortlink, res.headers.location);
		}
	}

	logInfo(`Normalized text: ${normalizedText}`);

	const images: {format: string, data: Buffer}[] = [];

	if (hasImage) {
		const twitterUrl = new URL(linkToTweet.trim());
		twitterUrl.hostname = 'api.vxtwitter.com';

		logInfo(`Fetching ${twitterUrl.toString()}`);

		const res = await axios.get(twitterUrl.toString(), {
			responseType: 'json',
		});

		if (res.status !== 200 || res.headers['content-type'] !== 'application/json') {
			logError(`Failed to fetch tweet: status ${res.status}, content-type ${res.headers['content-type']}`);
			response.status(500);
			response.send('Internal Server Error');
			return;
		}

		for (const mediaUrl of res.data.mediaURLs) {
			logInfo(`Found image: ${mediaUrl}`);

			const imageUrl = `${mediaUrl}?name=orig`;
			const imageRes = await axios.get<Buffer>(imageUrl, {
				responseType: 'arraybuffer',
				validateStatus: null,
			});

			if (imageRes.status !== 200) {
				logError(`Failed to fetch image: ${imageUrl}`);
				continue;
			}

			const imageFormat = path.extname(imageUrl).slice(1);
			images.push({format: imageFormat, data: imageRes.data});
		}

		if (images.length === 0) {
			logError('No images found');
		}
	}

	// Update Mastodon status
	if (destinations.includes('mastodon')) {
		try {
			const data = await postMastodon(normalizedText, images);
			logInfo(`Posted status: ${data.id}`);
		} catch (error) {
			logError(`Failed to post Mastodon status: ${error}`);
		}
	}

	// Update Bluesky status
	if (destinations.includes('bluesky')) {
		try {
			const data = await postBluesky(normalizedText, images);
			logInfo(`Posted bluesky status: ${data.uri}`);
		} catch (error) {
			logError(`Failed to post Bluesky status: ${error}`);
		}
	}

	// Update Threads status
	if (destinations.includes('threads') && normalizedText.length > 0) {
		try {
			const data = await postThreads(normalizedText);
			logInfo(`Posted Threads status: ${data.media.code}`);
		} catch (error) {
			logError(`Failed to post Threads status: ${error}`);
		}
	}

	// Update Slack status
	if (destinations.includes('slack')) {
		const files: File[] = [];

		if (images.length > 0) {
			const res = await slack.files.uploadV2({
				file_uploads: images.map((image) => ({
					file: image.data,
					filename: `image.${image.format}`,
				})),
			});

			// @ts-expect-error: slack.files.uploadV2 is not well typed
			files.push(...(res.files?.[0]?.files ?? []));
			logInfo(`Uploaded images: ${files.map((file) => file.id).join(', ')}`);
		}

		const postRes = await slack.chat.postMessage({
			as_user: true,
			channel: SANDBOX_ID,
			text: `${normalizedText} ${files.map((file) => file.permalink).map((link) => `<${link}| >`).join('')}`,
		});

		logInfo(`Posted Slack status: ${postRes.ts}`);
	}

	response.send('OK');
});

type Cookies = Record<string, {
	value: string,
	expires: Timestamp,
}>;

export const postSession = onRequest(
	{
		memory: '512MiB',
	},
	async (request, response) => {
		logInfo('postSession started');

		if (request.method !== 'POST') {
			response.status(405);
			response.send('Method Not Allowed');
			return;
		}

		const {apikey, id, session, expirationDate} = JSON.parse(request.rawBody.toString());

		if (apikey !== API_TOKEN.value()) {
			logError(`Invalid apikey: ${apikey}`);
			response.status(403);
			response.send('Forbidden');
			return;
		}

		if (id !== 'luna') {
			logError(`Invalid id: ${id}`);
			response.status(400);
			response.send('Bad Request');
			return;
		}

		if (typeof session !== 'string') {
			logError(`Invalid session: ${session}`);
			response.status(400);
			response.send('Bad Request');
			return;
		}

		if (typeof expirationDate !== 'number') {
			logError(`Invalid expirationDate: ${expirationDate}`);
			response.status(400);
			response.send('Bad Request');
			return;
		}

		logInfo(`Session: ${session}`);
		logInfo(`Expiration date: ${expirationDate}`);

		await db.runTransaction(async (transaction) => {
			logInfo('Transaction started');
			const state = await transaction.get(States.doc('luna'));
			if (!state.exists) {
				logError('State not found');
				return;
			}

			logInfo('State found');
			const cookies: Cookies = state.get('cookies');
			if (cookies === undefined) {
				logError('Cookies not found');
				return;
			}

			const expires = cookies.luna_session?.expires?.toMillis() ?? 0;
			logInfo(`Current session expires at: ${expires}`);
			if (expires >= expirationDate * 1000) {
				logInfo(`Session is already up-to-date (${expires} >= ${expirationDate * 1000})`);
				return;
			}

			logInfo(`Updating session to ${session}`);
			transaction.update(States.doc('luna'), {
				'cookies.luna_session': {
					value: session,
					expires: Timestamp.fromMillis(expirationDate * 1000),
				},
			});
		});

		response.send('OK');
	},
);
