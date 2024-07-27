import { ChildProcess, exec, spawn } from 'child_process'
import { appendFileSync, existsSync, readFileSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { createServer } from 'net'
import { kill } from 'process'

/**
 * @type {{ [x: string]: ChildProcess }}
 */

const runningService = {}
const runningNames = new Set()

process.on('SIGINT', () => {
    for (const subProcess of Object.values(runningService)) {
        subProcess.emit('close', 0, null)
    }
    setInterval(() => {
        if (runningNames.size == 0) process.exit(0)
    }, 300)
})

const commandMethods = {
    verifApplyArgs(data) {
        const filed = new Set(Object.keys(data))
        for (const requiredField of ['name', 'command']) {
            if (!filed.has(requiredField)) return 'invalid, service config must have ' + requiredField
        }
    },
    async apply(data) {
        const a = this.verifApplyArgs(data)
        if (a) return a
        if (runningService[data.name] instanceof ChildProcess) {
            await new Promise((r) => {
                runningService[data.name].emit('close', 0, null)
                const interval = setInterval(() => {
                    if (!runningService[data?.name]) {
                        clearInterval(interval)
                        r()
                    }
                }, 100)
            })
        }

        const [app, ...args] = data.command.split(' ').map(s => s.trim())
        console.log(app, args)
        if (typeof data?.cwd == 'string') {
            data.cwd = data.cwd.replace('~', process.env['HOME'])
        }
        const subProcess = spawn(app, args, {
            cwd: data?.cwd,
            env: process.env,
        })
        let directError = null
        subProcess.on('error', (err) => {
            if (directError == null) directError = err
            console.log(err)
            appendFileSync(`logs/${data.name}.jsonl`, JSON.stringify([new Date(), `${err}`.trim()]) + '\n')
        })
        subProcess.stdout.on('data', (d) => appendFileSync(`logs/${data.name}.jsonl`, JSON.stringify([new Date(), d.toString().trim()]) + '\n'))
        subProcess.stderr.on('data', (d) => appendFileSync(`logs/${data.name}.jsonl`, JSON.stringify([new Date(), d.toString().trim()]) + '\n'))
        subProcess.once('close', async (code, sig) => {
            const a = JSON.parse(await readFile(`services/${data.name}.json`))
            a.status = 'stop'
            a.pid = null
            a.runningTime = Date.now() - a.spawnedLast
            a.exitCode = code
            subProcess.kill()
            await writeFile(`services/${data.name}.json`, JSON.stringify(a))
            delete runningService[data.name]
            runningNames.delete(data.name)
            console.log(`closed ${data.name} [${code}] (${sig})`)
        })
        try {
            await new Promise((reslove, reject) => {
                setTimeout(() => {
                    if (directError !== null) reject(directError)
                }, 1000)
                subProcess.once('spawn', reslove)
            })
        } catch (err) {
            return JSON.stringify({ err })
        }
        console.log('spawned')
        for (const i in data?.runs || []) {
            const cmd = data.runs[i]
            if (i == data.runs.length - 1) {
                subProcess.stdin.write(`${cmd}\n`)
            } else {
                const err = await new Promise(r => subProcess.stdin.write(`${cmd}\n`, r))
                if (err) console.error(err)
            }
        }
        await writeFile(`services/${data.name}.json`, JSON.stringify({
            pid: subProcess.pid,
            data,
            status: 'running',
            spawnedLast: Date.now(),
            runningTime: 0
        }))
        runningService[data.name] = subProcess
        runningNames.add(data.name)
        return `service ${data.name} applyed`
    },

    async status(data) {
        if (typeof data?.name !== 'string') return 'invalid, check satus must have name service'
        try {
            if (!existsSync(`services/${data.name}.json`)) return `not found service ${data.name}, please applying`
            const service = JSON.parse(await readFile(`services/${data.name}.json`))
            if (service?.pid) {
                try {
                    process.kill(service.pid, 0)
                } catch (err) {
                    return JSON.stringify({ message: 'closed unexpected', service })
                }
                return JSON.stringify({ message: null, service })
            } else {
                return JSON.stringify({ message: 'closed', service })
            }
        } catch (err) {
            console.log(err)
            return 'err'
        }
    },

    async start(data) {
        const status = await this.status(data)
        let service = null
        try {
            service = JSON.parse(status)
            if (typeof service.service.pid == 'number') return `service ${data.name} is on running, restart if you want`
            try {
                console.log(await this.apply(service.service.data))
                return `started service ${data.name}`
            } catch (err) {
                console.log(err)
                return `error when starting ${data.name}`
            }
        } catch (err) {
            console.log(err)
            return status
        }
    },

    async restart(data) {
        const status = await this.status(data)
        let service = null
        try {
            service = JSON.parse(status)
            if (service.service.pid == null) return `service ${data.name} is closed, use start`
            try {
                console.log(await this.apply(service.service.data))
                return `restarted service ${data.name}`
            } catch (err) {
                console.log(err)
                return `error when restarting ${data.name}`
            }
        } catch (err) {
            console.log(err)
            return status
        }
    },

    async stop(data) {
        if (typeof data?.name !== 'string') return 'invalid, stop must have name service'
        if (existsSync(`services/${data.name}.json`)) {
            const service = JSON.parse(await readFile(`services/${data.name}.json`))
            if (typeof service.pid == 'number') {
                try {
                    process.kill(service.pid, 'SIGTERM')
                    service.status = 'stop'
                    service.pid = null
                    service.runningTime = Date.now() - service.spawnedLast
                    service.exitCode = 0
                    await writeFile(`services/${data.name}.json`, JSON.stringify(service))
                    delete runningService[data.name]
                    runningNames.delete(data.name)
                    return `stoped service ${data.name}`
                } catch (err) {
                    console.log(err)
                }
            }
        } else if (runningService[data.name] instanceof ChildProcess) {
            if (!runningService[data.name].killed()) {
                runningService[data.name].emit('close', 0, null)
                await new Promise((r) => {
                    const i = setInterval(() => {
                        if (!runningService[data.name]) {
                            clearInterval(i)
                            r()
                        }
                    })
                })
                return 'stoped service'
            }
        }
        return `service ${data.name} already stoped`
    },
    async logs(data) {
        if (typeof data?.name !== 'string') return 'invalid, get logs have name service'
        if (!existsSync(`logs/${data.name}.jsonl`)) return ''
        return await readFile(`logs/${data.name}.jsonl`)
    }
}
const config = JSON.parse(readFileSync('config.json'))
const server = createServer((socket) => {
    socket.on('data', async (data) => {
        try {
            const promp = JSON.parse(data)
            const command = Object.keys(promp)[0]
            const res = await commandMethods[command](promp[command])
            socket.write(res, () => {
                socket.end()
            })
        } catch (err) {
            console.log(err)
            socket.write('error')
        }
    })
}).listen(config.port, config.hostname, () => {
    console.log(`Server tcp run on ${config.hostname}:${config.port}`)
    console.log(server.address())
})