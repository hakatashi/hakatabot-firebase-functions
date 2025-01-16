import {Octokit} from '@octokit/rest';
import axios from 'axios';
import * as functions from 'firebase-functions';
import {logger, config as getConfig} from 'firebase-functions';
import {postBluesky, postMastodon, postThreads} from './lib/social.js';

const config = getConfig();

interface ScrapboxUser {
	id: string,
	name: string,
	displayName: string,
	photo: string, // URL
}

interface ScrapboxLine {
	id: string,
	text: string,
	userId: string,
	created: number,
	updated: number,
}

interface ScrapboxPage {
	id: string,
	title: string,
	image: string, // URL
	descriptions: string[],
	user: ScrapboxUser,
	pin: number,
	views: number,
	linked: number,
	commitId: string,
	created: number,
	updated: number,
	accessed: number,
	snapshotCreated: number,
	persistent: boolean,
	lines: ScrapboxLine[],
}

interface Entry {
	word: string,
	ruby: string,
	descriptions: string[],
	cite: string,
}

const github = new Octokit({
	auth: config.github.token,
});

const getCite = (cite: string, word: string) => {
	if (cite === 'goo') {
		return `<cite>[デジタル大辞泉「${word}」](https://dictionary.goo.ne.jp/word/${encodeURIComponent(word)}/)</cite>より引用`;
	}
	if (cite === 'kojien') {
		return `<cite>広辞苑「${word}」</cite>より引用`;
	}
	if (cite === 'kotobank') {
		return `<cite>[コトバンク「${word}」](https://kotobank.jp/word/${encodeURIComponent(word)})</cite>より引用`;
	}
	if (cite === 'wikipedia') {
		return `<cite>[${word} - Wikipedia](https://ja.wikipedia.org/wiki/${encodeURIComponent(word)})</cite>より引用`;
	}
	return '';
};

const updateWordBlogFunction = async (context: functions.EventContext) => {
	const date = new Intl.DateTimeFormat('eo', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(new Date(context.timestamp));

	logger.info('Retrieving Scrapbox data...');

	const scrapboxUrl = `https://scrapbox.io/api/pages/hakatashi/${encodeURIComponent('日本語')}`;
	const {data} = await axios.get<ScrapboxPage>(scrapboxUrl, {
		headers: {Cookie: `connect.sid=${config.scrapbox.sid}`},
	});
	logger.info(`Retrieved ${data.lines.length} lines from Scrapbox`);

	const entries: Entry[] = [];

	{
		let word = '';
		let ruby = '';
		let descriptions: string[] = [];
		let cite = '';
		for (const line of data.lines) {
			const indents = line.text.match(/^[ \t]*/)![0] || '';
			const indentLevel = indents.length;
			const text = line.text.trim();

			if (indentLevel === 0) {
				continue;
			}

			if (indentLevel === 1) {
				if (word !== '') {
					entries.push({word, ruby, descriptions, cite});
					ruby = '';
					descriptions = [];
					cite = '';
				}

				const tokens = text.split(/[()（）)]/);
				word = tokens[0].trim();
				if (tokens.length >= 2) {
					ruby = tokens[1].trim();
				}
				continue;
			}

			const tokens = text.split(': ');
			if (tokens[0] === 'cite' && tokens[1]) {
				cite = tokens[1].trim();
				continue;
			}

			descriptions.push('    '.repeat(indentLevel - 2) + text);
		}

		if (word !== '') {
			entries.push({word, ruby, descriptions, cite});
		}
	}

	entries.reverse();

	logger.info(`Retrieved ${entries.length} entries from Scrapbox`);

	const owner = 'hakatashi';
	const repo = 'word.hakatashi.com';

	logger.info('Getting default branch...');
	const {data: repoInfo} = await github.repos.get({owner, repo});
	const defaultBranch = repoInfo.default_branch;

	logger.info('Getting files under _posts directory...');
	const {data: files} = await github.repos.getContent({
		owner,
		repo,
		path: 'source/_posts',
		ref: defaultBranch,
	});

	const postedEntries = new Set<string>();

	if (Array.isArray(files)) {
		for (const file of files) {
			postedEntries.add(file.name.replace(/\.md$/, ''));
		}
	}

	logger.info(`Retrieved ${postedEntries.size} posted entries`);

	const entry = entries.find(({word}) => !postedEntries.has(word));
	if (entry === undefined) {
		logger.info('Couldn\'t find entry to post. Exiting...');
		return;
	}

	logger.info(`Posting entry ${JSON.stringify(entry, null, '  ')}`);

	const lines = [
		'---',
		`title: ${entry.word}`,
		`subtitle: ${entry.ruby}`,
		`date: ${date} 10:00:00`,
		'---',
		'',
		...entry.descriptions,
		'',
		getCite(entry.cite, entry.word),
	];

	logger.info(`File to post: ${JSON.stringify(lines)}`);

	logger.info('Getting commit hash...');
	const {data: ref} = await github.git.getRef({owner, repo, ref: `heads/${defaultBranch}`});
	const commitHash = ref.object.sha;

	logger.info('Getting tree hash...');
	const {data: commit} = await github.repos.getCommit({owner, repo, ref: commitHash});

	logger.info('Creating new tree...');
	const {data: tree} = await github.git.createTree({
		owner,
		repo,
		base_tree: commit.commit.tree.sha,
		tree: [
			{
				path: `source/_posts/${entry.word}.md`,
				mode: '100644',
				type: 'blob',
				content: lines.join('\n'),
			},
		],
	});

	logger.info('Creating new commit...');
	const {data: newCommit} = await github.git.createCommit({
		owner,
		repo,
		message: `BOT: Add source/_posts/${entry.word}.md`,
		author: {
			name: 'Koki Takahashi',
			email: 'hakatasiloving@gmail.com',
			date: new Date(context.timestamp).toISOString(),
		},
		parents: [ref.object.sha],
		tree: tree.sha,
	});

	logger.info('Updating ref...');
	const {data: newRef} = await github.git.updateRef({
		owner,
		repo,
		sha: newCommit.sha,
		force: false,
		ref: `heads/${defaultBranch}`,
	});

	logger.info(`done. (commit = ${newRef.object.sha})`);

	logger.info(`done. (commit = ${newRef.object.sha})`);

	logger.info('Waiting for 60 seconds...');

	await new Promise((resolve) => {
		setTimeout(resolve, 60 * 1000);
	});

	const url = `https://word.hakatashi.com/${date.replace(/-/g, '')}/`;

	logger.info('Posting to Mastodon...');
	try {
		const res = await postMastodon(`hakatashiの一日一語: 「${entry.word}」 ${url}`);
		logger.info(`done. (id_str = ${res.id})`);
	} catch (error) {
		logger.error(`Failed to post to Mastodon: ${error}`);
	}

	logger.info('Posting to Bluesky...');
	try {
		const res = await postBluesky(`hakatashiの一日一語: 「${entry.word}」 ${url}`);
		logger.info(`done. (id = ${res.id})`);
	} catch (error) {
		logger.error(`Failed to post to Bluesky: ${error}`);
	}

	logger.info('Posting to Threads...');
	try {
		const res = await postThreads(`hakatashiの一日一語: 「${entry.word}」 ${url}`);
		logger.info(`done. (id = ${res.id})`);
	} catch (error) {
		logger.error(`Failed to post to Threads: ${error}`);
	}

	logger.info('done.');
};

export const updateWordBlog = functions
	.runWith({timeoutSeconds: 120})
	.pubsub.schedule('0 10 * * *')
	.timeZone('Asia/Tokyo')
	.onRun(updateWordBlogFunction);
