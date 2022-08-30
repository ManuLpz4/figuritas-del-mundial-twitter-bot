//                                                                                                                                                                                 
// $$$$$$$$\ $$\                               $$\   $$\                                     $$\           $$\                                               $$\ $$\           $$\ 
// $$  _____|\__|                              \__|  $$ |                                    $$ |          $$ |                                              $$ |\__|          $$ |
// $$ |      $$\  $$$$$$\  $$\   $$\  $$$$$$\  $$\ $$$$$$\    $$$$$$\   $$$$$$$\        $$$$$$$ | $$$$$$\  $$ |      $$$$$$\$$$$\  $$\   $$\ $$$$$$$\   $$$$$$$ |$$\  $$$$$$\  $$ |
// $$$$$\    $$ |$$  __$$\ $$ |  $$ |$$  __$$\ $$ |\_$$  _|   \____$$\ $$  _____|      $$  __$$ |$$  __$$\ $$ |      $$  _$$  _$$\ $$ |  $$ |$$  __$$\ $$  __$$ |$$ | \____$$\ $$ |
// $$  __|   $$ |$$ /  $$ |$$ |  $$ |$$ |  \__|$$ |  $$ |     $$$$$$$ |\$$$$$$\        $$ /  $$ |$$$$$$$$ |$$ |      $$ / $$ / $$ |$$ |  $$ |$$ |  $$ |$$ /  $$ |$$ | $$$$$$$ |$$ |
// $$ |      $$ |$$ |  $$ |$$ |  $$ |$$ |      $$ |  $$ |$$\ $$  __$$ | \____$$\       $$ |  $$ |$$   ____|$$ |      $$ | $$ | $$ |$$ |  $$ |$$ |  $$ |$$ |  $$ |$$ |$$  __$$ |$$ |
// $$ |      $$ |\$$$$$$$ |\$$$$$$  |$$ |      $$ |  \$$$$  |\$$$$$$$ |$$$$$$$  |      \$$$$$$$ |\$$$$$$$\ $$ |      $$ | $$ | $$ |\$$$$$$  |$$ |  $$ |\$$$$$$$ |$$ |\$$$$$$$ |$$ |
// \__|      \__| \____$$ | \______/ \__|      \__|   \____/  \_______|\_______/        \_______| \_______|\__|      \__| \__| \__| \______/ \__|  \__| \_______|\__| \_______|\__|
//               $$\   $$ |                                                                                                                                                        
//               \$$$$$$  |                                                                                                                                                        
//                \______/                                                                                                                                                         
//                                                                                                                                                                                 

import { ETwitterStreamEvent, TwitterApi } from "twitter-api-v2";
import mongoose from 'mongoose';
import "dotenv/config";

const Schema = mongoose.Schema;
const userSchema = new Schema({
    id: String,
    repes: Array<String>,
    nolas: Array<String>,
});
const User = mongoose.model('User', userSchema);
await mongoose.connect(process.env.MONGO_DB_URI as string);

const twitterClient = new TwitterApi({
    appKey: process.env.TWITTER_CONSUMER_KEY as string,
    appSecret: process.env.TWITTER_CONSUMER_SECRET as string,
    accessToken: process.env.TWITTER_ACCESS_TOKEN as string,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET as string,
});
const twitterAppClient = await twitterClient.appLogin();
const rules = await twitterAppClient.v2.streamRules();

if (rules.data?.length) {
    await twitterAppClient.v2.updateStreamRules({
        delete: { ids: rules.data.map(rule => rule.id) },
    });
}

const me = (await twitterClient.v2.me()).data;

await twitterAppClient.v2.updateStreamRules({
    add: [{ value: `@${me.username} -is:retweet -from:${me.id}` }],
});

const stream = await twitterAppClient.v2.searchStream({
    'tweet.fields': ['referenced_tweets', 'author_id'],
    expansions: ['referenced_tweets.id'],
});

stream.autoReconnect = true;

stream.on(ETwitterStreamEvent.Data, async tweet => {
    console.log(tweet.data.text);

    const tweetAuthor = (await twitterClient.v2.user(tweet.data.author_id as string)).data;
    const myRepes = getRepesByTweet(tweet.data.text);
    const myNolas = getNolasByTweet(tweet.data.text);

    await User.findOneAndUpdate(
        { id: tweetAuthor.id },
        { repes: myRepes, nolas: myNolas },
        { upsert: true },
    );

    let repesMatchMap = new Map<string, Array<string>>();
    let nolasMatchMap = new Map<string, Array<string>>();
    const users = await User.find({});

    users.forEach((user: any) => {
        if (user.id !== tweetAuthor.id) {
            const repesMatches = myRepes?.filter((repe: string) => user.nolas.includes(repe));
            if (repesMatches) {
                const nolasMatches = myNolas?.filter((nola: string) => user.repes.includes(nola));
                if (nolasMatches) {
                    repesMatchMap.set(user.id, repesMatches);
                    nolasMatchMap.set(user.id, nolasMatches);
                }
            }
        }
    });

    repesMatchMap = new Map([...repesMatchMap.entries()].sort((a, b) => b[1].length - a[1].length));

    const preReplyText = `Che, @${tweetAuthor.username}\n`;
    const postReplyText = '\n\n¡Acordate de actualizar tus "repes" y "nolas" si cambiás alguna figurita así solo te aviso en las que te faltan! 😉';
    let replyText = preReplyText;
    const preReplyCharacterCount = (preReplyText + postReplyText).length;

    for (const repesMatch of repesMatchMap) {
        const nolasMatch = nolasMatchMap.get(repesMatch[0])!;
        const matchCollector = (await twitterClient.v2.user(repesMatch[0])).data;
        const matchReplyLine = `\nCambiale tu${repesMatch[1].length > 1 ? "s" : ""} ${repesMatch[1].toString().replace(",", ", ")} por su${nolasMatch.length > 1 ? "s" : ""} ${nolasMatch.toString().replace(",", ", ")} a @${matchCollector.username}`;
        if (preReplyCharacterCount + matchReplyLine.length > 280) break;
        replyText += matchReplyLine;
    }

    replyText += postReplyText;

    if (repesMatchMap.size) {
        console.log("repesMatchMap.size" + repesMatchMap.size);
        await twitterClient.v2.reply(replyText, tweet.data.id);
    }

});

const stickerRegExp = new RegExp("([A-Z]{3}( |)\\d{1,2})", "gi");

function getRepesByTweet(tweet: string) {
    const stickers = tweet.match(stickerRegExp);
    const nolasIndex = tweet.search("olas:");

    return stickers?.filter(sticker => tweet.indexOf(sticker) < nolasIndex);
}

function getNolasByTweet(tweet: string) {
    const stickers = tweet.match(stickerRegExp);
    const nolasIndex = tweet.search("olas:");

    return stickers?.filter(sticker => tweet.indexOf(sticker) > nolasIndex);
}
