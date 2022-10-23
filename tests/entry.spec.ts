import { test, expect } from "@playwright/test";
import { type Page, BrowserContext } from "@playwright/test";
import _, { result } from "lodash";
import * as fs from "fs";
import * as path from "path";

import { sleep } from "../utils";
import moment from "moment";

function readTags(): Array<string> {
  const buffer = fs.readFileSync(path.resolve(__dirname, "../files/tags.txt"));
  const str = buffer.toString("utf-8");
  const rows = _.split(str, "\n");
  return _.uniq(
    _.filter(
      _.map(rows, (r) => _.trim(r)),
      (r) => !_.isEmpty(r)
    )
  );
}

async function processUser(page: Page, username: string): Promise<any> {
  console.log("Processing username", username);
  await page.goto(`https://www.instagram.com/${username}/`);

  const resp = await page.waitForResponse(
    /i.instagram.com\/api\/v1\/users\/web_profile_info*/
  );
  const body = await resp.json();

  const user = body.data.user;
  return user;
}

async function processTag(
  tag: string,
  context: BrowserContext
): Promise<Array<any>> {
  console.log("Processing tag", tag);
  const page = await context.newPage();
  await page.goto(`https://www.instagram.com/explore/tags/${tag}/`);

  const resp = await page.waitForResponse(
    /i.instagram.com\/api\/v1\/tags\/web_info*/
  );
  const body = await resp.json();
  const sections: Array<any> = body.data.top.sections;
  const flattened: Array<any> = _.map(
    sections,
    (section) => section!.layout_content!.medias
  );

  const media: Array<any> = _.reduce(
    flattened,
    (section, acc) => acc.concat(section),
    []
  );

  const results = await Promise.all(
    _.map(media, (m) => processMedium(m, context))
  );
  await page.close();
  return results.map(({ user, postCode }) => ({
    username: user.username,
    followers: user.edge_followed_by.count,
    postCode: postCode,
    tag,
  }));
}

async function processTags(
  tags: Array<string>,
  context: BrowserContext
): Promise<Array<any>> {
  const results: Array<any> = [];

  const chunked = _.chunk(tags, 2);
  for (const chunk of chunked) {
    const res: Array<any> = await Promise.all(
      _.map(chunk, (tag) => processTag(tag, context))
    );
    res.forEach((v) => results.push(v));
  }
  return results;
}

async function processMedium(
  medium: any,
  context: BrowserContext
): Promise<any> {
  const username = medium.media.user.username;
  const userPage = await context.newPage();
  const user = await processUser(userPage, username);
  await userPage.close();
  return {
    postCode: medium.media.code,
    user,
  };
}

function formatPostUrl(postCode: string) {
  return `https://www.instagram.com/p/${postCode}`;
}

const HEADER = ["Username", "Followers", "Post", "Tag"];

test("Executing", async ({ page, context }) => {
  const timestamp = moment().format("YYYY-MM-DD_hh_mm_ss");
  const tags = readTags();
  await page.goto("https://www.instagram.com/");
  await page.waitForLoadState("load");
  console.log("Typing username");

  const usernameField = await page.locator("input[name='username']");
  await usernameField?.type(process.env.USERNAME!);

  console.log("Typing password");

  const passwordField = await page.locator("input[name='password']");
  await passwordField?.type(process.env.PASSWORD!);

  console.log("Logging in");
  const loginForm = await page.locator("form#loginForm");
  const loginButton = await loginForm.locator("button[type='submit']");
  await loginButton.click();
  await page.waitForLoadState("networkidle");

  const tagResults = await processTags(tags, context);

  const rows = _.reduce(tagResults, (res, acc) => acc.concat(res), []);
  const csv = [HEADER.join(",")]
    .concat(
      rows.map(
        ({ username, followers, postCode, tag }) =>
          `${username},${followers},${formatPostUrl(postCode)},${tag}`
      )
    )
    .join("\n");
  fs.writeFileSync(
    path.resolve(__dirname, "../files/", `${timestamp}.csv`),
    csv
  );
});
