import assert from 'node:assert';
import {KnownBlock} from '@slack/web-api';
import type {CollectionReference, DocumentData} from 'firebase-admin/firestore';
import {config as getConfig} from 'firebase-functions';
import {info as logInfo} from 'firebase-functions/logger';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import chunk from 'lodash/chunk.js';
import groupBy from 'lodash/groupBy.js';
import scrapeIt from 'scrape-it';
import {States, db} from '../firestore.js';
import {webClient as slack} from '../slack.js';

const config = getConfig();

const normalizeHtml = (html: string | null) => (
	(html ?? '').replaceAll(/<(?:br|hr)>/g, '\n')
		.replaceAll(/<.+?>/g, '')
		.replaceAll(/\n+/g, '\n')
		.trim()
);

interface SerialCode {
	code: string,
	description: string,
	source: string,
}

interface GameWithScrapedData {
	serialCodes: {code: string, description: string}[],
}

const getGameWithSerialCodeSelector = (url: string) => {
	if (url.startsWith('https://gamewith.jp/wutheringwaves/')) {
		return '.alert-yellow + table tbody tr:not(:first-child)';
	}
	if (url.startsWith('https://gamewith.jp/genshin/')) {
		return '.genshin_table_table table tbody tr:not(:first-child)';
	}
	if (url.startsWith('https://gamewith.jp/houkaistarrail/')) {
		return '.housta_droptable table tbody tr:not(:first-child)';
	}
	if (url.startsWith('https://gamewith.jp/zenless/')) {
		return '.zzz_code table tbody tr:not(:first-child)';
	}
	throw new Error(`Unknown URL: ${url}`);
};

const getGameWithSerialCodes = async (url: string) => {
	logInfo(`getGameWithSerialCodes: ${url}`);

	assert(url.startsWith('https://gamewith.jp/'));

	await new Promise((resolve) => {
		setTimeout(resolve, 1000);
	});

	const {data} = await scrapeIt<GameWithScrapedData>(url, {
		serialCodes: {
			listItem: getGameWithSerialCodeSelector(url),
			data: {
				code: '.w-clipboard-copy-ui',
				description: {
					selector: 'td:last-child',
					how: 'html',
					convert: normalizeHtml,
				},
			},
		},
	});

	logInfo(`getGameWithSerialCodes: Retrieved ${data.serialCodes.length} serial codes from ${url}`);

	return data.serialCodes.map(({code, description}) => ({code, description, source: url}));
};

interface Game8ScrapedData {
	tables: {
		rows: {
			cells: {
				text: string,
			}[],
		}[],
	}[],
}

const getGame8SerialCodes = async (url: string) => {
	logInfo(`getGame8SerialCodes: ${url}`);

	assert(url.startsWith('https://game8.jp/'));

	await new Promise((resolve) => {
		setTimeout(resolve, 1000);
	});

	const {data} = await scrapeIt<Game8ScrapedData>(url, {
		tables: {
			listItem: 'table',
			data: {
				rows: {
					listItem: 'tr',
					data: {
						cells: {
							listItem: 'td',
							data: {
								text: {
									how: 'html',
									convert: normalizeHtml,
								},
							},
						},
					},
				},
			},
		},
	});

	const serialCodes: SerialCode[] = [];
	const isZenless = url.startsWith('https://game8.jp/zenless/');

	if (url.startsWith('https://game8.jp/genshin/')) {
		for (const table of data.tables) {
			let additionalInfo = '';
			for (const row of table.rows) {
				if (!row.cells.some((cell) => cell.text.includes('自動入力リンク'))) {
					continue;
				}

				if (row.cells.length === 3) {
					additionalInfo = row.cells[0].text;
					serialCodes.push({
						code: row.cells[1].text.split('\n')[0].trim(),
						description: `${row.cells[2].text}\n${additionalInfo}`,
						source: url,
					});
				}

				if (row.cells.length === 2) {
					serialCodes.push({
						code: row.cells[0].text.split('\n')[0].trim(),
						description: `${row.cells[1].text}\n${additionalInfo}`,
						source: url,
					});
				}
			}
		}
	} else {
		for (const table of data.tables) {
			for (const row of table.rows) {
				if (row.cells.length < 2) {
					continue;
				}
				const cell = isZenless ? row.cells[1] : row.cells[0];
				if (!cell) {
					continue;
				}
				const lines = cell.text.split('\n');
				const code = isZenless ? lines.slice(-2)[0]?.trim() : lines[0]?.trim();
				const additionalInfo = isZenless ? '' : lines.slice(1).join('\n').trim();
				if (!code?.match(/^[A-Z0-9]+$/)) {
					continue;
				}
				serialCodes.push({
					code,
					description: `${row.cells[1].text}\n${additionalInfo}`,
					source: url,
				});
			}
		}
	}

	logInfo(`getGame8SerialCodes: Retrieved ${serialCodes.length} serial codes from ${url}`);

	return serialCodes;
};

interface AltemaScrapedData {
	tables: {
		rows: {
			header: string,
			cells: {
				text: string,
			}[],
		}[],
	}[],
}

const getAltemaSerialCodes = async (url: string) => {
	logInfo(`getAltemaSerialCodes: ${url}`);

	assert(url.startsWith('https://altema.jp/'));

	await new Promise((resolve) => {
		setTimeout(resolve, 1000);
	});

	const {data} = await scrapeIt<AltemaScrapedData>(url, {
		tables: {
			listItem: 'table',
			data: {
				rows: {
					listItem: 'tr:not(:first-child)',
					data: {
						header: {
							selector: 'th',
							how: 'html',
							convert: normalizeHtml,
						},
						cells: {
							listItem: 'td',
							data: {
								text: {
									how: 'html',
									convert: normalizeHtml,
								},
							},
						},
					},
				},
			},
		},
	});

	const serialCodes: SerialCode[] = [];

	for (const table of data.tables) {
		for (const row of table.rows) {
			let code: string | null = null;

			if (row.header.includes('入力に進む')) {
				code = row.header.split('\n')[0].trim();
			} else if (row.header.endsWith('コピー')) {
				code = row.header.replace(/コピー$/, '').trim();
			} else if (row.header.match(/^[A-Z0-9]{6,}$/)) {
				code = row.header;
			} else if (row.cells[0]?.text.match(/^[A-Z0-9]{6,}$/)) {
				code = row.cells[0].text;
			} else if (row.header === '' && row.cells[1]?.text.match(/^[A-Z0-9]{6,}$/)) {
				code = row.cells[1].text;
			}

			if (code === null || !code.match(/^[A-Z0-9]{6,}$/)) {
				continue;
			}

			const additionalInfo = row.cells[row.cells.length - 1].text;
			serialCodes.push({
				code,
				description: additionalInfo,
				source: url,
			});
		}
	}

	logInfo(`getAltemaSerialCodes: Retrieved ${serialCodes.length} serial codes from ${url}`);

	return serialCodes;
};

interface GenshinSerialCodesState extends DocumentData {
	serialCodes: Record<string, {
			game: string,
			description: string,
			source: string,
			createdAt: number,
		}>,
}

const getMarkupedSerialCode = (game: string, code: string) => {
	if (game === '原神') {
		return `<https://genshin.hoyoverse.com/ja/gift?code=${code}|*${code}*>`;
	}
	if (game === '崩壊:スターレイル') {
		return `<https://hsr.hoyoverse.com/gift?code=${code}|*${code}*>`;
	}
	if (game === 'ゼンレスゾーンゼロ') {
		return `<https://zenless.hoyoverse.com/redemption/gift?code=${code}|*${code}*>`;
	}
	return code;
};

export const postGenshinSerialCodesCronJob = onSchedule('every 20 minutes', async () => {
	logInfo('postGenshinSerialCodesCronJob: started');

	const now = Date.now();

	const serialCodeGames = [
		{
			game: '原神',
			serialCodes: [
				...await getGameWithSerialCodes('https://gamewith.jp/genshin/article/show/231856'),
				...await getGame8SerialCodes('https://game8.jp/genshin/356868'),
				...await getAltemaSerialCodes('https://altema.jp/gensin/serialcode'),
			],
		},
		{
			game: '崩壊:スターレイル',
			serialCodes: [
				...await getGameWithSerialCodes('https://gamewith.jp/houkaistarrail/article/show/396232'),
				...await getGame8SerialCodes('https://game8.jp/houkaistarrail/524795'),
				...await getAltemaSerialCodes('https://altema.jp/houkaistarrail/serialcode'),
			],
		},
		{
			game: '鳴潮',
			serialCodes: [
				...await getGameWithSerialCodes('https://gamewith.jp/wutheringwaves/451073'),
				...await getGame8SerialCodes('https://game8.jp/meicho/610907'),
				...await getAltemaSerialCodes('https://altema.jp/meichou/code'),
			],
		},
		{
			game: 'ゼンレスゾーンゼロ',
			serialCodes: [
				...await getGameWithSerialCodes('https://gamewith.jp/zenless/452252'),
				...await getGame8SerialCodes('https://game8.jp/zenless/607577'),
				...await getAltemaSerialCodes('https://altema.jp/zenless/serialcode'),
			],
		},
	];

	const stateDoc = (States as CollectionReference<GenshinSerialCodesState>).doc('genshin-serial-codes');

	const newSerialCodes: (SerialCode & {game: string})[] = [];

	const result = await db.runTransaction(async (transaction) => {
		let isFirstRun = false;
		let hasUpdate = false;

		const state = await transaction.get(stateDoc);
		if (!state.exists) {
			isFirstRun = true;
		}

		const lastSerialCodes = state.data()?.serialCodes ?? {};

		for (const {game, serialCodes} of serialCodeGames) {
			for (const {code, description, source} of serialCodes) {
				if (Object.hasOwn(lastSerialCodes, code)) {
					continue;
				}

				newSerialCodes.push({game, code, description, source});

				hasUpdate = true;

				lastSerialCodes[code] = {
					game,
					description,
					source,
					createdAt: now,
				};
			}
		}

		if (hasUpdate) {
			transaction.set(stateDoc, {serialCodes: lastSerialCodes}, {merge: true});
		}

		return {isFirstRun};
	});

	logInfo(`postGenshinSerialCodesCronJob: Found ${newSerialCodes.length} new serial codes`);
	logInfo(`postGenshinSerialCodesCronJob: isFirstRun = ${result.isFirstRun}`);

	if (!result.isFirstRun && newSerialCodes.length > 0) {
		const serialCodesByGame = groupBy(newSerialCodes, 'game');

		const blocks: KnownBlock[] = [
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: '新しいシリアルコードを見つけてきたぜ～！',
				},
			},
			...Object.entries(serialCodesByGame).map(([game, serialCodes]) => ([
				{
					type: 'header',
					text: {
						type: 'plain_text',
						text: game,
					},
				} as KnownBlock,
				...serialCodes.map(({code, description, source}) => (
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: `${getMarkupedSerialCode(game, code)}\n${description.replaceAll(/\n/g, ' ')}`,
						},
						accessory: {
							type: 'button',
							text: {
								type: 'plain_text',
								text: 'ソース',
								emoji: true,
							},
							url: source,
						},
					} as KnownBlock
				)),
			])).flat(),
		];

		for (const blocksChunk of chunk(blocks, 50)) {
			await slack.chat.postMessage({
				channel: config.slack.channels.genshin,
				text: '新しいシリアルコードを見つけてきたぜ～！',
				icon_url: 'https://pbs.twimg.com/media/Eh8ugAaU4AEe0qd?format=png&name=small',
				username: 'パイモン',
				blocks: blocksChunk,
				unfurl_links: false,
				unfurl_media: false,
			});
		}
	}
});
