# HakataBot on firebase functions

## HakataBot Series

* [hakatabot](https://github.com/hakatashi/hakatabot)
* [hakatabot-heroku](https://github.com/hakatashi/hakatabot-heroku)
* [**hakatabot-firebase-functions**](https://github.com/hakatashi/hakatabot-firebase-functions)

## Debug

```sh
npx firebase functions:config:export

# For cron functions
npx firebase functions:shell

# For HTTP functions
npx firebase emulators:start --only functions

npm run build:watch
```

## Deploy

```sh
firebase deploy
```
