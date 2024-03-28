import qs from 'querystring';
import {Client as ThreadsClient} from '@threadsjs/threads.js';
import axios from 'axios';
import {logger, config as getConfig} from 'firebase-functions';

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

interface Image {
	data: Buffer,
	format: string,
}

export const postMastodon = async (text: string, images: Image[] = []) => {
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
		status: text,
		visibility: 'public',
		media_ids: mediaIds,
	}), {
		headers: {
			Authorization: `Bearer ${config.mastodon.access_token}`,
			'Content-Type': 'application/json',
		},
	});

	return res.data;
};

export const postBluesky = async (text: string, images: Image[] = []) => {
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
		throw new Error('Failed to create Bluesky session');
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
			text,
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

	return postRes.data;
};

export const postThreads = async (text: string) => {
	const client = new ThreadsClient({});

	await client.login(config.threads.username, config.threads.password);

	if (client.options.token === undefined) {
		throw new Error('Failed to create Threads session');
	}

	const res = await axios.post(config.threads.post_url, qs.stringify({
		signed_body: `SIGNATURE.${JSON.stringify({
			publish_mode: 'text_post',
			text_post_app_info: '{"reply_control":0}',
			timezone_offset: '0',
			source_type: '4',
			_uid: config.threads.user_id,
			device_id: 'android-1234567890123',
			caption: text,
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

	return res.data;
};
