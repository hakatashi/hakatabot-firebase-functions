/* eslint-env jest */
/* eslint-disable import/newline-after-import, import/no-extraneous-dependencies, import/order, import/first, import/imports-first */

import firebaseFunctionsTest from 'firebase-functions-test';
const test = firebaseFunctionsTest();

import {glyphwikibotCronJob} from './glyphwikibot';
import axios from 'axios';
import download from 'download';
import twitter from '../twitter';

jest.mock('axios');
jest.mock('download');
jest.mock('../twitter');

// @ts-expect-error: Type mismatch
const glyphwikibotCronJobFn = test.wrap(glyphwikibotCronJob);

const randomGlyphURL = 'https://glyphwiki.org/wiki/Special:Random';

describe('glyphwikibot', () => {
	describe('glyphwikibotCronJobFn', () => {
		it('succeeds', async () => {
			/* eslint-disable-next-line require-await */
			(axios.get as jest.Mock).mockImplementation(async (url) => {
				if (url === randomGlyphURL) {
					return {
						status: 302,
						headers: {location: 'https://glyphwiki.org/wiki/u6f22'},
					};
				}
				return {
					status: 200,
					data: '<h1>u6f22 <span style="font-size: 60%;">(国際符号化文字集合・ユニコード統合漢字 U+6F22「漢」)</span> <span style="font-size: 60%;">(@30)</span></h1>',
				};
			});

			(download as jest.Mock).mockResolvedValue(Buffer.from(''));
			(twitter as jest.Mock).mockResolvedValue({
				media_id_string: '123456789',
				id_str: '987654321',
			});

			await glyphwikibotCronJobFn({});
			expect((twitter as jest.Mock).mock.calls).toHaveLength(2);
			expect((twitter as jest.Mock).mock.calls[1]).toEqual([
				'glyphwikibot',
				'POST',
				'statuses/update',
				{
					media_ids: '123456789',
					status: 'u6f22 (国際符号化文字集合・ユニコード統合漢字 U+6F22「漢」) https://glyphwiki.org/wiki/u6f22',
				},
			]);
		});
	});
});

