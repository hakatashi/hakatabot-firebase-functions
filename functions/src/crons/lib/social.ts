import qs from 'node:querystring';
import {Client as ThreadsClient} from '@threadsjs/threads.js';
import axios from 'axios';
import {info as logInfo} from 'firebase-functions/logger';
import {defineString} from 'firebase-functions/params';

const MASTODON_HOSTNAME = defineString('MASTODON_HOSTNAME');
const MASTODON_ACCESS_TOKEN = defineString('MASTODON_ACCESS_TOKEN');
const BLUESKY_USERNAME = defineString('BLUESKY_USERNAME');
const BLUESKY_PASSWORD = defineString('BLUESKY_PASSWORD');
const THREADS_USERNAME = defineString('THREADS_USERNAME');
const THREADS_PASSWORD = defineString('THREADS_PASSWORD');
const THREADS_POST_URL = defineString('THREADS_POST_URL');
const THREADS_USER_ID = defineString('THREADS_USER_ID');
const THREADS_USER_AGENT = defineString('THREADS_USER_AGENT');

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

const htmlEscape = (text: string) => (
	text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll('\'', '&#39;')
);

interface Image {
	data: Buffer,
	format: string,
}

export const postMastodon = async (text: string, images: Image[] = []) => {
	const mediaIds: string[] = [];

	const escapedText = htmlEscape(text).replaceAll('\n', '<br>');

	for (const image of images) {
		const formData = new FormData();
		const blob = new Blob([image.data.buffer], {
			type: imageFormatToMimeType(image.format)!,
		});
		formData.append('file', blob, `image.${image.format}`);

		const res = await axios.post(`https://${MASTODON_HOSTNAME.value()}/api/v2/media`, formData, {
			headers: {
				Authorization: `Bearer ${MASTODON_ACCESS_TOKEN.value()}`,
				'Content-Type': 'multipart/form-data',
			},
		});

		logInfo(`Uploaded image: ${res.data.id}`);
		mediaIds.push(res.data.id);
	}

	const res = await axios.post(`https://${MASTODON_HOSTNAME.value()}/api/v1/statuses`, JSON.stringify({
		status: escapedText,
		visibility: 'public',
		media_ids: mediaIds,
	}), {
		headers: {
			Authorization: `Bearer ${MASTODON_ACCESS_TOKEN.value()}`,
			'Content-Type': 'application/json',
		},
	});

	return res.data;
};

interface BlueskySpan {
	start: number,
	end: number,
	url: string,
}

export const parseBlueskyUrls = (text: string) => {
	const spans: BlueskySpan[] = [];
	const urlRegex = /(?<prefix>[$|\W])(?<url>https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*[-a-zA-Z0-9@%_+~#//=])?)/g;

	let match: RegExpExecArray | undefined;
	while (
		(match = urlRegex.exec(text) ?? undefined) !== undefined &&
		match.groups?.url !== undefined &&
		match.groups?.prefix !== undefined
	) {
		const bytesStart = Buffer.byteLength(text.slice(0, match.index));
		const prefixLength = Buffer.byteLength(match.groups.prefix);
		const urlLength = Buffer.byteLength(match.groups.url);
		spans.push({
			start: bytesStart + prefixLength,
			end: bytesStart + prefixLength + urlLength,
			url: match.groups.url,
		});
	}

	return spans;
};

export const postBluesky = async (text: string, images: Image[] = []) => {
	const res = await axios.post('https://bsky.social/xrpc/com.atproto.server.createSession', JSON.stringify({
		identifier: BLUESKY_USERNAME.value(),
		password: BLUESKY_PASSWORD.value(),
	}), {
		headers: {
			'Content-Type': 'application/json',
		},
	});

	const session = res.data.accessJwt;
	if (typeof session !== 'string') {
		throw new Error('Failed to create Bluesky session');
	}

	logInfo(`Bluesky session: ${session}`);

	const blobs: any[] = [];

	for (const image of images) {
		const uploadRes = await axios.post('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', image.data, {
			headers: {
				'Content-Type': imageFormatToMimeType(image.format)!,
				Authorization: `Bearer ${session}`,
			},
		});

		logInfo(`Uploaded image: ${JSON.stringify(uploadRes.data.blob)}`);

		blobs.push(uploadRes.data.blob);
	}

	const spans = parseBlueskyUrls(text);

	const postRes = await axios.post('https://bsky.social/xrpc/com.atproto.repo.createRecord', JSON.stringify({
		repo: BLUESKY_USERNAME.value(),
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
			...(spans.length > 0 ? {
				facets: spans.map((span) => ({
					index: {
						byteStart: span.start,
						byteEnd: span.end,
					},
					features: [
						{
							$type: 'app.bsky.richtext.facet#link',
							uri: span.url,
						},
					],
				})),
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

	await client.login(THREADS_USERNAME.value(), THREADS_PASSWORD.value());

	if (client.options.token === undefined) {
		throw new Error('Failed to create Threads session');
	}

	const res = await axios.post(THREADS_POST_URL.value(), qs.stringify({
		signed_body: `SIGNATURE.${JSON.stringify({
			publish_mode: 'text_post',
			text_post_app_info: '{"reply_control":0}',
			timezone_offset: '0',
			source_type: '4',
			_uid: THREADS_USER_ID.value(),
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
			'User-Agent': THREADS_USER_AGENT.value(),
			'Sec-Fetch-Site': 'same-origin',
			'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			Authorization: `Bearer IGT:2:${client.options.token}`,
		},
		validateStatus: null,
	});

	return res.data;
};
