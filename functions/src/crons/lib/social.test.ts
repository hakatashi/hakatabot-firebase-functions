/* eslint-env jest */

import {parseBlueskyUrls} from './social.js';

describe('parseBlueskyUrls', () => {
	it('should return an empty array when no URLs are present', () => {
		const result = parseBlueskyUrls('This is a test string with no URLs.');
		expect(result).toEqual([]);
	});

	it('should correctly identify a simple URL', () => {
		const result = parseBlueskyUrls('a http://google.com b');
		expect(result).toEqual([
			{
				start: 2,
				end: 19,
				url: 'http://google.com',
			},
		]);
	});

	// https://docs.bsky.app/docs/advanced-guides/posts#mentions-and-links
	it('should correctly identify a complex URL', () => {
		const result = parseBlueskyUrls('\u2728 example mentioning @atproto.com to share the URL \ud83d\udc68\u200d\u2764\ufe0f\u200d\ud83d\udc68 https://en.wikipedia.org/wiki/CBOR.');
		expect(result).toEqual([
			{
				start: 74,
				end: 108,
				url: 'https://en.wikipedia.org/wiki/CBOR',
			},
		]);
	});

	it('should correctly identify multiple URLs', () => {
		const result = parseBlueskyUrls('This is a test string with multiple URLs: https://example.com, http://test.com.');
		expect(result).toEqual([
			{
				start: 42,
				end: 61,
				url: 'https://example.com',
			},
			{
				start: 63,
				end: 78,
				url: 'http://test.com',
			},
		]);
	});

	it('should correctly identify URLs with path and query parameters', () => {
		const result = parseBlueskyUrls('This is a test string with a URL: https://example.com/path?query=param.');
		expect(result).toEqual([
			{
				start: 34,
				end: 70,
				url: 'https://example.com/path?query=param',
			},
		]);
	});
});
