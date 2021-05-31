# HakataBot on firebase functions

## HakataBot Series

* [hakatabot](https://github.com/hakatashi/hakatabot)
* [hakatabot-heroku](https://github.com/hakatashi/hakatabot-heroku)
* [**hakatabot-firebase-functions**](https://github.com/hakatashi/hakatabot-firebase-functions)

## Debug

```
firebase functions:config:get > functions/.runtimeconfig.json
firebase functions:shell
npm run build -- -- --watch
```

## Deploy

```
firebase functions:config:set slack.signing_secret=$SLACK_SIGNING_SECRET
firebase functions:config:set slack.token=$SLACK_TOKEN
firebase deploy
```
