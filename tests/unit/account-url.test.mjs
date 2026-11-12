// Разбор ввода «аккаунт»: ссылки, ники, ошибки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountParseError, buildProfileUrl, detectPlatform, parseAccountInput } from '../../src/lib/account-url.mjs';

test('ссылка Instagram распознаётся с www и без', () => {
  for (const input of [
    'https://www.instagram.com/masha.eats/',
    'https://instagram.com/masha.eats',
    'instagram.com/masha.eats',
    'http://www.instagram.com/masha.eats/?hl=ru',
  ]) {
    const parsed = parseAccountInput(input);
    assert.equal(parsed.platform, 'instagram', input);
    assert.equal(parsed.handle, 'masha.eats', input);
  }
});

test('ссылка на пост Instagram отклоняется как не профиль', () => {
  assert.throws(
    () => parseAccountInput('https://www.instagram.com/p/Cabc123/'),
    (error) => error instanceof AccountParseError && error.code === 'post_url',
  );
});

test('ссылка YouTube @handle и /channel/ID', () => {
  assert.deepEqual(
    { platform: parseAccountInput('https://www.youtube.com/@ProCoding').platform, handle: parseAccountInput('https://www.youtube.com/@ProCoding').handle },
    { platform: 'youtube', handle: 'ProCoding' },
  );
  assert.equal(
    parseAccountInput('https://www.youtube.com/channel/UCabc123').handle,
    'UCabc123',
  );
  assert.equal(
    parseAccountInput('https://youtube.com/c/SomeChannel').handle,
    'SomeChannel',
  );
});

test('ссылка на видео YouTube отклоняется с понятным кодом', () => {
  assert.throws(
    () => parseAccountInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    (error) => error.code === 'video_url',
  );
  assert.throws(
    () => parseAccountInput('https://youtu.be/dQw4w9WgXcQ'),
    (error) => error.code === 'video_url',
  );
});

test('из ссылки TikTok на видео достаётся профиль автора', () => {
  assert.equal(parseAccountInput('https://www.tiktok.com/@danceka').handle, 'danceka');
  // В адресе видео есть @автор — это однозначно говорит, чей это аккаунт,
  // поэтому ссылку принимаем и берём профиль, а не отклоняем.
  assert.equal(
    parseAccountInput('https://www.tiktok.com/@danceka/video/7200000000000').handle,
    'danceka',
  );
  // Без автора в адресе разобрать нечего.
  assert.throws(
    () => parseAccountInput('https://www.tiktok.com/t/ZTRabc123/'),
    (error) => error.code === 'profile_required',
  );
});

test('@ник без платформы даёт понятную ошибку', () => {
  assert.throws(
    () => parseAccountInput('@someone'),
    (error) => error instanceof AccountParseError && error.code === 'unknown_platform',
  );
});

test('платформа берётся из подсказки, если в вводе только ник', () => {
  const parsed = parseAccountInput('masha.eats', 'instagram');
  assert.equal(parsed.platform, 'instagram');
  assert.equal(parsed.handle, 'masha.eats');
  assert.equal(parsed.url, 'https://www.instagram.com/masha.eats/');
});

test('пустой ввод отклоняется', () => {
  assert.throws(() => parseAccountInput('   '), AccountParseError);
});

test('недопустимые символы в нике отклоняются', () => {
  assert.throws(
    () => parseAccountInput('https://www.instagram.com/masha%20eats<script>'),
    (error) => error.code === 'invalid_account',
  );
});

test('detectPlatform понимает все три платформы', () => {
  assert.equal(detectPlatform('https://instagram.com/a'), 'instagram');
  assert.equal(detectPlatform('https://youtube.com/@a'), 'youtube');
  assert.equal(detectPlatform('https://tiktok.com/@a'), 'tiktok');
  assert.equal(detectPlatform('https://vk.com/a'), null);
});

test('buildProfileUrl собирает адреса по платформам', () => {
  assert.equal(buildProfileUrl('instagram', 'a'), 'https://www.instagram.com/a/');
  assert.equal(buildProfileUrl('youtube', 'a'), 'https://www.youtube.com/@a');
  assert.equal(buildProfileUrl('tiktok', 'a'), 'https://www.tiktok.com/@a');
});
