import path from 'path';
import qs from 'querystring';
import type {File} from '@slack/web-api/dist/response/FilesUploadResponse.js';
import {Client as ThreadsClient} from '@threadsjs/threads.js';
import axios from 'axios';
import {load as cheerio} from 'cheerio';
import {https, logger, config as getConfig} from 'firebase-functions';
import {SANDBOX_ID} from '../const.js';
import {webClient as slack} from '../slack.js';

const config = getConfig();

const imageFormatToMimeType = (format: string) => {
	switch (format) {
		case 'png':
			return 'image/png';
		case 'jpg':
			return 'image/jpeg';
		case 'gif':
			return 'image/gif';
	}

	return null;
};

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

	normalizedText = normalizedText.replace(/\s+/g, ' ').trim();

	logger.info(`Normalized text: ${normalizedText}`);

	const images: {format: string, data: Buffer}[] = [];

	if (hasImage) {
		const twitterUrl = new URL(linkToTweet.trim());
		twitterUrl.hostname = config.nitter.hostname;

		logger.info(`Fetching ${twitterUrl.toString()}`);

		const res = await axios.get(twitterUrl.toString());

		const $ = cheerio(res.data);

		for (const $img of $('.still-image').toArray()) {
			const link = $img.attribs.href;
			const basename = path.basename(link, path.extname(link));
			const mediaId = decodeURIComponent(basename).split('/').pop();
			logger.info(`Found image: ${mediaId}`);

			let imageData: Buffer | null = null;
			let imageFormat: string | null = null;

			for (const format of ['jpg', 'png', 'gif']) {
				const imageUrl = `https://pbs.twimg.com/media/${mediaId}?format=${format}&name=orig`;
				const imageRes = await axios.get(imageUrl, {
					responseType: 'arraybuffer',
					validateStatus: null,
				});

				if (imageRes.status === 200) {
					logger.info(`Found image with format ${format}`);
					imageData = imageRes.data;
					imageFormat = format;
					break;
				}
			}

			if (imageData === null || imageFormat === null) {
				logger.error(`Failed to fetch image: ${mediaId}`);
				continue;
			}

			images.push({format: imageFormat, data: imageData});
		}

		if (images.length === 0) {
			logger.error('No images found');
		}
	}

	// Update Mastodon status
	if (destinations.includes('mastodon')) {
		const mediaIds: string[] = [];

		for (const image of images) {
			const formData = new FormData();
			const blob = new Blob([image.data.buffer], {
				type: imageFormatToMimeType(image.format)!,
			});
			formData.append('file', blob, `image.${image.format}`);

			const res = await axios.post(`https://${config.mastodon.hostname}/api/v2/media`, formData, {
				headers: {
					Authorization: `Bearer ${config.mastodon.access_token}`,
					'Content-Type': 'multipart/form-data',
				},
			});

			logger.info(`Uploaded image: ${res.data.id}`);
			mediaIds.push(res.data.id);
		}

		const res = await axios.post(`https://${config.mastodon.hostname}/api/v1/statuses`, JSON.stringify({
			status: normalizedText,
			visibility: 'public',
			media_ids: mediaIds,
		}), {
			headers: {
				Authorization: `Bearer ${config.mastodon.access_token}`,
				'Content-Type': 'application/json',
			},
		});

		logger.info(`Posted status: ${res.data.id}`);
	}

	// Update Bluesky status
	if (destinations.includes('bluesky')) {
		const res = await axios.post('https://bsky.social/xrpc/com.atproto.server.createSession', JSON.stringify({
			identifier: config.bluesky.username,
			password: config.bluesky.password,
		}), {
			headers: {
				'Content-Type': 'application/json',
			},
		});

		const session = res.data.accessJwt;
		if (typeof session !== 'string') {
			logger.error('Failed to create Bluesky session');
			return;
		}

		logger.info(`Bluesky session: ${session}`);

		const blobs: any[] = [];

		for (const image of images) {
			const uploadRes = await axios.post('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', image.data, {
				headers: {
					'Content-Type': imageFormatToMimeType(image.format)!,
					Authorization: `Bearer ${session}`,
				},
			});

			logger.info(`Uploaded image: ${JSON.stringify(uploadRes.data.blob)}`);

			blobs.push(uploadRes.data.blob);
		}

		const postRes = await axios.post('https://bsky.social/xrpc/com.atproto.repo.createRecord', JSON.stringify({
			repo: config.bluesky.username,
			collection: 'app.bsky.feed.post',
			record: {
				$type: 'app.bsky.feed.post',
				text: normalizedText,
				createdAt: new Date().toISOString(),
				...(blobs.length > 0 ? {
					embed: {
						$type: 'app.bsky.embed.images',
						images: blobs.map((blob) => ({
							alt: '',
							image: blob,
						})),
					},
				} : {}),
			},
		}), {
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${session}`,
			},
			validateStatus: null,
		});

		logger.info(`Posted bluesky status: ${postRes.data.uri}`);
	}

	// Update Threads status
	if (destinations.includes('threads') && normalizedText.length > 0) {
		const client = new ThreadsClient({});

		await client.login(config.threads.username, config.threads.password);

		if (client.options.token === undefined) {
			logger.error('Failed to create Threads session');
			return;
		}

		const res = await axios.post(config.threads.post_url, qs.stringify({
			signed_body: `SIGNATURE.${JSON.stringify({
				publish_mode: 'text_post',
				text_post_app_info: '{"reply_control":0}',
				timezone_offset: '0',
				source_type: '4',
				_uid: config.threads.user_id,
				device_id: 'android-1234567890123',
				caption: normalizedText,
				device: {
					manufacturer: 'OnePlus',
					model: 'ONEPLUS+A3003',
					android_version: 26,
					android_release: '8.1.0',
				},
			})}`,
		}), {
			headers: {
				'User-Agent': config.threads.user_agent,
				'Sec-Fetch-Site': 'same-origin',
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
				Authorization: `Bearer IGT:2:${client.options.token}`,
			},
			validateStatus: null,
		});

		logger.info(`Posted Threads status: ${res.data.media.code}`);
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

			files.push(...((res.files as any)?.[0]?.files ?? []));
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

