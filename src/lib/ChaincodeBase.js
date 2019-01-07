const util = require('util');

const ChaincodeError = require('./ChaincodeError');
const TransactionHelper = require('./TransactionHelper');

const migrations = require('./../utils/migrations');
const loggerUtils = require('./../utils/logger');
const normalizePayload = require('./../utils/normalizePayload');

const ERRORS = require('./../constants/errors');

class ChaincodeBase {

    constructor(shim) {
        this.shim = shim;
        this.migrating = false;
        this.logger = loggerUtils.getLogger(`chaincode/${this.name}`);
    }

    /**
     * @return the name of the current chaincode.
     */
    get name() {

        return this.constructor.name;
    }

    /**
     * @return the path where the migrations can be found for the current chaincode.
     */
    get migrationsPath() {

        throw new ChaincodeError(ERRORS.MIGRATION_PATH_NOT_DEFINED);
    }

    /**
     * @return the transaction helper for the given stub. This can be used to extend
     * the Default TransactionHelper with extra functionality and return your own instance.
     */
    getTransactionHelperFor(stub) {

        return new TransactionHelper(stub);
    }

    /**
     * Responsible for parsing params and constructing the transaction helper
     */
    setupInvoke(stub, params) {
        return {
            parsedParameters: this.parseParameters(params),
            txHelper: this.getTransactionHelperFor(stub)
        };
    }

    /**
     * @param {Array} params
     * @returns the parsed parameters
     */
    parseParameters(params) {
        const parsedParams = [];

        params.forEach((param) => {
            try {
                // try to parse ...
                parsedParams.push(JSON.parse(param));
            } catch (err) {
                // if it fails fall back to original param
                // regular strings fall into this category, so do not log them as errors
                parsedParams.push(param);
            }
        });

        return parsedParams;
    }

    /**
     * Prep payload for return to caller
     * @param {*} payload 
     */
    prepareResponsePayload(payload, txHelper) {

        if (!Buffer.isBuffer(payload)) {
            return Buffer.from(payload ? JSON.stringify(normalizePayload(payload)) : '');
        }
        return payload;
    }

    /**
     * Called when Instantiating chaincode
     */
    async Init() {
        this.logger.info(`=========== Instantiated Chaincode ${this.name} ===========`);

        return this.shim.success();
    }

    /**
     * Basic implementation that redirects Invocations to the right functions on this instance
     */
    async Invoke(stub) {
        try {

            const ret = stub.getFunctionAndParameters();

            this.logger.info(`=========== Invoked Chaincode ${this.name} : ${ret.fcn} : ${stub.getTxID()} ===========`);
            // Don't log args or return value... It leaks PII

            const method = this[ret.fcn];
            if (!method) {
                this.logger.error(`Unknown function ${ret.fcn}.`);

                return this.shim.error(new ChaincodeError(ERRORS.UNKNOWN_FUNCTION, {
                    'fn': ret.fcn
                }).serialized);
            }

            let parsedParameters;
            let txHelper;
            try {
                setup = this.setupInvoke(stub, ret.params);
                parsedParameters = setup.parsedParameters;
                txHelper = setup.txHelper;
            } catch (err) {
                throw new ChaincodeError(ERRORS.PARSING_PARAMETERS_ERROR, {
                    'message': err.message
                });
            }

            let payload = await method.call(this, stub, txHelper, ...parsedParameters);
            payload = this.prepareResponsePayload(payload, txHelper);

            this.logger.info(`=========== Invoke Chaincode COMPLETE ${this.name} : ${ret.fcn} : ${stub.getTxID()} ===========`);

            return this.shim.success(payload);
        } catch (err) {
            let error = err;

            const stacktrace = err.stack;

            if (!(err instanceof ChaincodeError)) {
                error = new ChaincodeError(ERRORS.UNKNOWN_ERROR, {
                    'message': err.message
                });
            }
            this.logger.error(stacktrace);
            this.logger.error(`Data of error ${err.message}: ${JSON.stringify(err.data)}`);
            this.logger.error(`=========== Invoke Chaincode FAILED ${this.name} : ${ret.fcn} : ${stub.getTxID()} ===========`);

            return this.shim.error(error.serialized);
        }
    }

    /**
     * Run Migrations for the current chaincode.
     *
     * @param {Stub} stub
     * @param {TransactionHelper} txHelper
     * @param {Array} args
     */
    async runMigrations(stub, txHelper, ...args) {
        this.migrating = true;
        const result = await migrations.runMigrations(this.migrationsPath, this, stub, txHelper, args);
        this.migrating = false;

        return result;
    }

    /**
     * Returns 'pong' when everything is correct.
     */
    async ping() {

        return 'pong';
    }

}

module.exports = ChaincodeBase;
