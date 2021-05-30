# HakataBot on firebase functions

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
