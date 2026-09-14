Thank you for running this project. It is recommended to run it on VS Studio Code on live server for quick run
since everything comes pre-built.

Live site: http://aitzazimtiaz.xyz/webdev/

For simple run:
    npm install
    npx http-server -p 5500

For rebuild:

    npm run build  # build:db, then build:culture, then build:policy

Individually:
    npm run build:db
    npm run build:culture
    npm run build:policy
    npm run watch:culture

For checks:

    npm run html
    npm run a11y