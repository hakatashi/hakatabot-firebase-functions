# HakataBot on firebase functions

## HakataBot Series

* [hakatabot](https://github.com/hakatashi/hakatabot)
* [hakatabot-heroku](https://github.com/hakatashi/hakatabot-heroku)
* [**hakatabot-firebase-functions**](https://github.com/hakatashi/hakatabot-firebase-functions)

## Debug

```sh
firebase functions:config:get > functions/.runtimeconfig.json

# For cron functions
firebase functions:shell

# For HTTP functions
firebase emulators:start --only functions

npm run build:watch
```

## Deploy

```sh
firebase functions:config:set slack.signing_secret=$SLACK_SIGNING_SECRET
firebase functions:config:set slack.token=$SLACK_TOKEN
firebase deploy
```
