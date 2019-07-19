'use strict';

const multicastdns = require('multicast-dns');
const dnsEqual = require('dns-equal');
const flatten = require('array-flatten');
var _isEqual = require('lodash').isEqual;

module.exports = Server;

function Server(opts) {
	this.mdns = multicastdns(opts);
	this.mdns.setMaxListeners(0);
	this.registry = {};
	this.mdns.on('query', this._respondToQuery.bind(this))
	this.recentResponses = [];
	this.clearCacheTime = 5000;
	this.timer = null;
}

Server.prototype.register = function (records) {
	const self = this;

	if (Array.isArray(records)) records.forEach(register);
	else register(records);

	function register(record) {
		let subRegistry = self.registry[record.type];
		if (!subRegistry) subRegistry = self.registry[record.type] = [];
		else if (subRegistry.some(isDuplicateRecord(record))) return;
		subRegistry.push(record)
	}
};

Server.prototype.unregister = function (records) {
	const self = this;

	if (Array.isArray(records)) records.forEach(unregister);
	else unregister(records);

	function unregister(record) {
		const type = record.type;
		if (!(type in self.registry)) return;
		self.registry[type] = self.registry[type].filter(function (r) {
			return r.name !== record.name
		})
	}
};

Server.prototype._clearTimer = function () {
	//console.log('clearing cache');
	//console.log(this.recentResponses);
	this.recentResponses.splice(0,this.recentResponses.length)
	clearTimeout(this.timer);
	this.timer = null;
};
Server.prototype._respondToQuery = function(query) {
    var self = this;
    if (self.timer == null)
        self.timer = setTimeout(self._clearTimer.bind(self), self.clearCacheTime);

    query.questions.forEach(function(question) {

        const type = question.type;
        const name = question.name;

        // generate the answers section
        const answers = type === 'ANY' ?
            flatten.depth(Object.keys(self.registry).map(self._recordsFor.bind(self, name)), 1) :
            self._recordsFor(name, type);

        if (answers.length === 0) return;

        // generate the additionals section
        let additionals = [];
        if (type !== 'ANY') {
            answers.forEach(function(answer) {
                if (answer.type !== 'PTR') return;
                additionals = additionals
                    .concat(self._recordsFor(answer.data, 'SRV'))
                    .concat(self._recordsFor(answer.data, 'TXT'))
            });

            // to populate the A and AAAA records, we need to get a set of unique
            // targets from the SRV record
            additionals
                .filter(function(record) {
                    return record.type === 'SRV'
                })
                .map(function(record) {
                    return record.data.target
                })
                .filter(unique())
                .forEach(function(target) {
                    additionals = additionals
                        .concat(self._recordsFor(target, 'A'))
                        .concat(self._recordsFor(target, 'AAAA'))
                })
        }
        let currentResponse = {
            answers: answers,
            additionals: additionals
        };

        let foundRecentResponse = false;

        for (let recentResponseCtr = 0; recentResponseCtr < self.recentResponses.length; recentResponseCtr++) {
            if (_isEqual(self.recentResponses[recentResponseCtr], currentResponse)) {
                foundRecentResponse = true;
                //console.log('found recent response!!!!')
                break;
            }
        }

        if (!foundRecentResponse) {
            self.recentResponses.push(Object.assign({}, currentResponse));
            self.mdns.respond(currentResponse, function(err) {
                if (err) throw err // TODO: Handle this (if no callback is given, the error will be ignored)
            })

        } else {
            //console.log('**RECENTLY SENT SAME RESPONSE**')
        }
    })

};

Server.prototype._recordsFor = function (name, type) {
	if (!(type in this.registry)) return [];

	return this.registry[type].filter(function (record) {
		const _name = ~name.indexOf('.') ? record.name : record.name.split('.')[0];
		return dnsEqual(_name, name)
	})
};

function isDuplicateRecord(a) {
	return function (b) {
		return a.type === b.type &&
			a.name === b.name &&
			deepEqual(a.data, b.data)
	}
}

function unique() {
	const set = [];
	return function (obj) {
		if (~set.indexOf(obj)) return false;
		set.push(obj);
		return true
	}
}
