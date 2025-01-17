import path from 'node:path';
import qs from 'node:querystring';
import type {File} from '@slack/web-api/dist/types/response/FilesUploadResponse.js';
import axios from 'axios';
import {https, logger, config as getConfig} from 'firebase-functions';
import {SANDBOX_ID} from '../const.js';
import {postBluesky, postMastodon, postThreads} from '../crons/lib/social.js';
import {webClient as slack} from '../slack.js';

const config = getConfig();

export const updateSocialPost = https.onRequest(async (request, response) => {
	logger.info('updateSocialPost started');

	if (request.method !== 'POST') {
		response.status(405);
		response.send('Method Not Allowed');
		return;
	}

	const {text, linkToTweet, token, destinations: rawDestinations = ''} = qs.parse(request.rawBody.toString());

	if (token !== config.api.token) {
		logger.error('Invalid token');
		response.status(403);
		response.send('Forbidden');
		return;
	}

	if (typeof text !== 'string' || text.length === 0) {
		logger.error('Invalid text');
		response.status(400);
		response.send('Bad Request');
		return;
	}

	if (typeof linkToTweet !== 'string' || linkToTweet.length === 0) {
		logger.error('Invalid linkToTweet');
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
		logger.error('Invalid destinations');
		response.status(400);
		response.send('Bad Request');
		return;
	}

	const normalizedDestinations = new Set(rawDestinations.split(',').filter((destination) => (
		['mastodon', 'bluesky', 'threads', 'slack'].includes(destination)
	)));

	const destinations = normalizedDestinations.size === 0 ? ['mastodon', 'bluesky', 'threads', 'slack'] : [...normalizedDestinations];

	logger.info(`text: ${text}`);
	logger.info(`link to tweet: ${linkToTweet}`);
	logger.info(`destinations: ${destinations.join(', ')}`);

	const shortlinks = text.matchAll(/https:\/\/t\.co\/[a-zA-Z0-9]+/g);

	let normalizedText = text.trim();
	let hasImage = false;

	for (const [shortlink] of shortlinks) {
		logger.info(`Resolving shortlink: ${shortlink}`);

		const res = await axios.get(shortlink, {
			maxRedirects: 0,
			validateStatus: (status) => status === 301,
		});

		const location = res.headers.location as string | undefined;

		logger.info(`Resolved shortlink to ${location}`);

		if (location === undefined) {
			logger.error(`Failed to resolve shortlink: ${shortlink}`);
			continue;
		}

		if (location.startsWith('https://twitter.com/') && location.includes('/photo/')) {
			hasImage = true;
			normalizedText = normalizedText.replace(shortlink, '');
		} else {
			normalizedText = normalizedText.replace(shortlink, res.headers.location);
		}
	}

	logger.info(`Normalized text: ${normalizedText}`);

	const images: {format: string, data: Buffer}[] = [];

	if (hasImage) {
		const twitterUrl = new URL(linkToTweet.trim());
		twitterUrl.hostname = 'api.vxtwitter.com';

		logger.info(`Fetching ${twitterUrl.toString()}`);

		const res = await axios.get(twitterUrl.toString(), {
			responseType: 'json',
		});

		if (res.status !== 200 || res.headers['content-type'] !== 'application/json') {
			logger.error(`Failed to fetch tweet: status ${res.status}, content-type ${res.headers['content-type']}`);
			response.status(500);
			response.send('Internal Server Error');
			return;
		}

		for (const mediaUrl of res.data.mediaURLs) {
			logger.info(`Found image: ${mediaUrl}`);

			const imageUrl = `${mediaUrl}?name=orig`;
			const imageRes = await axios.get<Buffer>(imageUrl, {
				responseType: 'arraybuffer',
				validateStatus: null,
			});

			if (imageRes.status !== 200) {
				logger.error(`Failed to fetch image: ${imageUrl}`);
				continue;
			}

			const imageFormat = path.extname(imageUrl).slice(1);
			images.push({format: imageFormat, data: imageRes.data});
		}

		if (images.length === 0) {
			logger.error('No images found');
		}
	}

	// Update Mastodon status
	if (destinations.includes('mastodon')) {
		try {
			const data = await postMastodon(normalizedText, images);
			logger.info(`Posted status: ${data.id}`);
		} catch (error) {
			logger.error(`Failed to post Mastodon status: ${error}`);
		}
	}

	// Update Bluesky status
	if (destinations.includes('bluesky')) {
		try {
			const data = await postBluesky(normalizedText, images);
			logger.info(`Posted bluesky status: ${data.uri}`);
		} catch (error) {
			logger.error(`Failed to post Bluesky status: ${error}`);
		}
	}

	// Update Threads status
	if (destinations.includes('threads') && normalizedText.length > 0) {
		try {
			const data = await postThreads(normalizedText);
			logger.info(`Posted Threads status: ${data.media.code}`);
		} catch (error) {
			logger.error(`Failed to post Threads status: ${error}`);
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
			logger.info(`Uploaded images: ${files.map((file) => file.id).join(', ')}`);
		}

		const postRes = await slack.chat.postMessage({
			as_user: true,
			channel: SANDBOX_ID,
			text: `${normalizedText} ${files.map((file) => file.permalink).map((link) => `<${link}| >`).join('')}`,
		});

		logger.info(`Posted Slack status: ${postRes.ts}`);
	}

	response.send('OK');
});

