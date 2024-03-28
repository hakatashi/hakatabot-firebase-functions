/* eslint-env jest */

import {jest} from '@jest/globals';
import {when} from 'jest-when';

jest.mock('download');
jest.mock('lodash/sample.js');

const {default: rawDownload} = await import('download');
const download = rawDownload as jest.MockedFunction<typeof rawDownload>;

const {default: rawSample} = await import('lodash/sample.js');
const sample = rawSample as jest.MockedFunction<typeof rawSample>;

const {getWaka} = await import('./waka');

describe('getWaka', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	it('should return the correct result', async () => {
		when<Promise<Buffer>, [string]>(download)
			.calledWith('https://ja.wikisource.org/w/api.php?format=json&action=query&prop=revisions&rvprop=content&titles=%E5%8F%A4%E4%BB%8A%E5%92%8C%E6%AD%8C%E9%9B%86')
			.mockResolvedValue(Buffer.from(JSON.stringify({
				query: {
					pages: {
						1: {
							revisions: [
								{
									'*': [
										'*[[/巻一|巻第一]]　春歌 上',
										'*[[/巻二|巻第二]]　春歌 下',
										'*[[/巻三|巻第三]]　夏歌',
										'*[[/巻四|巻第四]]　秋歌 上',
										'*[[/巻五|巻第五]]　秋歌 下',
										'*[[/巻六|巻第六]]　冬歌',
									].join('\n'),
								},
							],
						},
					},
				},
			})));

		when<Promise<Buffer>, [string]>(download)
			.calledWith('https://ja.wikisource.org/w/api.php?format=json&action=query&prop=revisions&rvprop=content&titles=%E5%8F%A4%E4%BB%8A%E5%92%8C%E6%AD%8C%E9%9B%86%2F%E5%B7%BB%E4%B8%80')
			.mockResolvedValue(Buffer.from(JSON.stringify({
				query: {
					pages: {
						1: {
							revisions: [
								{
									'*': [
										'<span id="00001">00001</span>',
										'[詞書]ふるとしに春たちける日よめる',
										'在原元方',
										'としのうちに春はきにけりひととせをこそとやいはむことしとやいはむ',
										'としのうちに－はるはきにけり－ひととせを－こそとやいはむ－ことしとやいはむ',
										'<span id="00002">00002</span>',
										'[詞書]はるたちける日よめる',
										'紀貫之',
										'袖ひちてむすひし水のこほれるを春立つけふの風やとくらむ',
										'そてひちて－むすひしみつの－こほれるを－はるたつけふの－かせやとくらむ',
									].join('\n'),
								},
							],
						},
					},
				},
			})));

		sample.mockImplementation((array: string[]) => array[0]);

		const result = await getWaka();

		expect(download).toHaveBeenCalledTimes(2);
		expect(sample).toHaveBeenCalledTimes(3);

		expect(result).toBe('としのうちに春はきにけりひととせをこそとやいはむことしとやいはむ──在原元方\u3000『古今集』春上・1');
	});
});

export {};
