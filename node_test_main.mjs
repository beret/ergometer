import {setConnector} from './model.mjs'
import {getConnector} from './sqlite.mjs'
import {run} from './test.mjs'

console.log('setConnector')
setConnector(getConnector({temporary: true}))

import './model.test.mjs'

;(async () => {
    console.log(`${await run()} pass`)
})()
