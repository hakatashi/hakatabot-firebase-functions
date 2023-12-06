import qs from 'querystring';
import download from 'download';
import get from 'lodash/get.js';
import sample from 'lodash/sample.js';

const pages = {
	古今和歌集: '古今集',
	後撰和歌集: '後撰集',
	拾遺和歌集: '拾遺集',
	新古今和歌集: '新古今集',
	千載和歌集: '千載集',
} as Record<string, string>;

const getBody = async (title: string) => {
	console.log(`Getting wikisource ${title}...`);
	const url = `https://ja.wikisource.org/w/api.php?${qs.encode({
		format: 'json',
		action: 'query',
		prop: 'revisions',
		rvprop: 'content',
		titles: title,
	})}`;

	const content = await download(url);
	const body = get(
		Object.values(get(JSON.parse(content.toString()), ['query', 'pages'])),
		[0, 'revisions', 0, '*'],
	) as string;

	return body;
};

export const getWaka = async () => {
	const page = sample(Object.keys(pages))!;
	const pageBody = await getBody(page);

	if (!pageBody) {
		return '';
	}

	const entryRegexp = /^\*\s*\[\[(?<path>.+?)\|.+?\]\][ \u3000]*(?<title>.+?)$/gm;
	const matches = pageBody.matchAll(entryRegexp);

	const {path, title} = sample(Array.from(matches))?.groups ?? {};
	const entryBody = await getBody(`${page}${path}`);

	if (!entryBody) {
		return '';
	}

	let number = null;
	let author = null;
	let text = null;
	let results = null;

	const wakas = [];

	for (const rawLine of entryBody.split('\n')) {
		const line = rawLine.trim();

		if (line.length === 0 || line.includes('詞書') || line.includes('－')) {
			continue;
		}

		if ((results = line.match(/\d+/))) {
			// eslint-disable-next-line prefer-destructuring
			number = results[0];
			author = null;
			text = null;
		} else if (line.length > 15) {
			text = line;
		} else {
			author = line.match(/(?:よみ人|読み人|読人)/) ? '読人不知' : line;
		}

		if (number && author && text) {
			wakas.push({number, author, text});
			number = null;
			author = null;
			text = null;
		}
	}

	const waka = sample(wakas)!;
	return `${waka.text}──${waka.author}\u3000『${pages[page]}』${title.replace(
		/(?:[歌\s一二三四五六七八九]|（.+?）)/g,
		'',
	)}・${parseInt(waka.number)}`;
};
