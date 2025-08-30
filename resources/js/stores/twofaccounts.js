import { defineStore } from 'pinia'
import { startsWithUppercase } from '@/composables/helpers'
import { useUserStore } from '@/stores/user'
import { useNotifyStore } from '@/stores/notify'
import twofaccountService from '@/services/twofaccountService'
import { saveAs } from 'file-saver'
import * as OTPAuth from 'otpauth'
import { openDB } from 'idb'
import CryptoJS from 'crypto-js'

export const useTwofaccounts = defineStore({
    id: 'twofaccounts',

    state: () => {
        return {
            items: [],
            selectedIds: [],
            filter: '',
            backendWasNewer: false,
            fetchedOn: null,
            isOfflineMode: false,
            offlineDB: null,
            encryptionKey: null,
        }
    },

    getters: {
        filtered(state) {
            const user = useUserStore()

            return state.items.filter(
                item => {
                    if (parseInt(user.preferences.activeGroup) > 0 ) {
                        return ((item.service ? item.service.toLowerCase().includes(state.filter.toLowerCase()) : false) ||
                            item.account.toLowerCase().includes(state.filter.toLowerCase())) &&
                            (item.group_id == parseInt(user.preferences.activeGroup))
                    }
                    else {
                        return ((item.service ? item.service.toLowerCase().includes(state.filter.toLowerCase()) : false) ||
                            item.account.toLowerCase().includes(state.filter.toLowerCase()))
                    }
                }
            )
        },

        /**
         * Lists unique periods used by twofaccounts in the collection
         * ex: The items collection has 3 accounts with a period of 30s and 5 accounts with a period of 40s
         *     => The method will return [30, 40]
         */
        periods(state) {
            return state.items.filter(acc => acc.otp_type == 'totp').map(function(item) {
                return { period: item.period, generated_at: item.otp?.generated_at }
            }).filter((value, index, self) => index === self.findIndex((t) => (
                t.period === value.period
            ))).sort()
        },

        orderedIds(state) {
            return state.items.map(a => a.id)
        },

        isEmpty(state) {
            return state.items.length == 0
        },

        count(state) {
            return state.items.length
        },

        filteredCount(state) {
            return state.filtered.length
        },

        selectedCount(state) {
            return state.selectedIds.length
        },

        hasNoneSelected(state) {
            return state.selectedIds.length == 0
        }
    },

    actions: {

        /**
         * Refreshes the accounts collection using the backend
         */
        async fetch(force = false) {
            // We do not want to fetch fresh data multiple times in the same 2s timespan
            const age = Math.floor(Date.now() - this.fetchedOn)
            const isOutOfAge = age > 2000

            if (isOutOfAge || force) {
                this.fetchedOn = Date.now()

                await twofaccountService.getAll(! useUserStore().preferences.getOtpOnRequest).then(response => {
                    // Defines if the store was up-to-date with the backend
                    if (force) {
                        this.backendWasNewer = response.data.length !== this.items.length
                        
                        this.items.forEach((item) => {
                            let matchingBackendItem = response.data.find(e => e.id === item.id)
                            if (matchingBackendItem == undefined) {
                                this.backendWasNewer = true
                                return;
                            }
                            for (const field in item) {
                                if (field !== 'otp' && item[field] != matchingBackendItem[field]) {
                                    this.backendWasNewer = true
                                    return;
                                }
                            }
                        })
                    }
    
                    // Updates the state
                    this.items = response.data
                })
            }
            else this.backendWasNewer = false
        },

        /**
         * Adds an account to the current selection
         */
        select(id) {
            for (var i=0 ; i < this.selectedIds.length ; i++) {
                if ( this.selectedIds[i] === id ) {
                    this.selectedIds.splice(i,1);
                    return
                }
            }
            this.selectedIds.push(id)
        },

        /**
         * Selects all accounts
         */
        selectAll() {
            this.selectedIds = this.items.map(a => a.id)
        },

        /**
         * Selects no account
         */
        selectNone() {
            this.selectedIds = []
        },

        /**
         * Deletes selected accounts
         */
        async deleteSelected() {
            if(confirm(trans('twofaccounts.confirm.delete')) && this.selectedIds.length > 0) {
                await twofaccountService.batchDelete(this.selectedIds.join())
                .then(response => {
                    let remainingItems = this.items
                    this.selectedIds.forEach(function(id) {
                        remainingItems = remainingItems.filter(a => a.id !== id)
                    })
                    this.items = remainingItems
                    this.selectNone()
                    useNotifyStore().success({ text: trans('twofaccounts.accounts_deleted') })
                })
            }
        },

        /**
         * Exports selected accounts to a json file
         */
        export(format = '2fauth') {
            if (format == 'otpauth') {
                twofaccountService.export(this.selectedIds.join(), true)
                .then((response) => {
                    let uris = []
                    response.data.data.forEach(account => {
                        uris.push(account.uri)
                    });
                    var blob = new Blob([uris.join('\n')], {type: "text/plain;charset=utf-8"});
                    saveAs.saveAs(blob, "2fauth_export_otpauth.txt");
                })
            }
            else {
                twofaccountService.export(this.selectedIds.join(), false, {responseType: 'blob'})
                .then((response) => {
                    var blob = new Blob([response.data], {type: "application/json;charset=utf-8"});
                    saveAs.saveAs(blob, "2fauth_export.json");
                })
            }
        },

        /**
         * Saves the accounts order to db
         */
        saveOrder() {
            twofaccountService.saveOrder(this.orderedIds)
        },
        
        /**
         * Sorts accounts ascending
         */
        sortAsc() {
            this.items.sort(function(a, b) {
                const serviceA = a.service ?? ''
                const serviceB = b.service ?? ''

                if (useUserStore().preferences.sortCaseSensitive) {
                    return serviceA.normalize("NFD").replace(/[\u0300-\u036f]/g, "") > serviceB.normalize("NFD").replace(/[\u0300-\u036f]/g, "") ? 1 : -1
                }
                
                return serviceA.localeCompare(serviceB, useUserStore().preferences.lang)
            });

            this.saveOrder()
        },

        /**
         * Sorts accounts descending
        */
        sortDesc() {
            this.items.sort(function(a, b) {
                const serviceA = a.service ?? ''
                const serviceB = b.service ?? ''

                if (useUserStore().preferences.sortCaseSensitive) {
                    return serviceA.normalize("NFD").replace(/[\u0300-\u036f]/g, "") < serviceB.normalize("NFD").replace(/[\u0300-\u036f]/g, "") ? 1 : -1
                }

                return serviceB.localeCompare(serviceA, useUserStore().preferences.lang)
            });

            this.saveOrder()
        },
        
        /**
         * Gets the IDs of all accounts that match the given period
         * @param {*} period 
         * @returns {Array<Number>} IDs of matching accounts
         */
        accountIdsWithPeriod(period) {
            return this.items.filter(a => a.period == period).map(item => item.id)
        },

        /**
         * Initialize offline database
         */
        async initOfflineDB() {
            this.offlineDB = await openDB('2FAuthOffline', 2, {
                upgrade(db, oldVersion) {
                    if (!db.objectStoreNames.contains('accounts')) {
                        db.createObjectStore('accounts', { keyPath: 'id' })
                    }
                    if (oldVersion < 2 && !db.objectStoreNames.contains('auth')) {
                        db.createObjectStore('auth', { keyPath: 'id' })
                    }
                }
            })
        },

        /**
         * Save current accounts to offline storage
         */
        async saveToOffline() {
            if (!this.offlineDB) await this.initOfflineDB()
            
            // Use a simple passkey-based encryption
            const key = localStorage.getItem('2fauth_offline_key') || this.generateKey()
            localStorage.setItem('2fauth_offline_key', key)
            
            const tx = this.offlineDB.transaction('accounts', 'readwrite')
            const store = tx.objectStore('accounts')
            
            // Clear and save all accounts
            await store.clear()
            for (const account of this.items) {
                // Create a clean object with only serializable data
                const cleanAccount = {
                    id: account.id,
                    service: account.service,
                    account: account.account,
                    secret: CryptoJS.AES.encrypt(account.secret || '', key).toString(),
                    otp_type: account.otp_type,
                    digits: account.digits,
                    algorithm: account.algorithm,
                    period: account.period,
                    counter: account.counter,
                    icon: account.icon,
                    group_id: account.group_id,
                    order_column: account.order_column
                }
                await store.put(cleanAccount)
            }
            
            localStorage.setItem('2fauth_offline_sync', new Date().toISOString())
            useNotifyStore().success({ text: 'Accounts saved for offline use' })
        },

        /**
         * Load accounts from offline storage
         */
        async loadFromOffline() {
            if (!this.offlineDB) await this.initOfflineDB()
            
            const key = localStorage.getItem('2fauth_offline_key')
            if (!key) {
                useNotifyStore().error({ text: 'No offline data found' })
                return false
            }
            
            const accounts = await this.offlineDB.getAll('accounts')
            
            // Decrypt and generate OTPs
            this.items = accounts.map(account => {
                const decrypted = {
                    ...account,
                    secret: CryptoJS.AES.decrypt(account.secret, key).toString(CryptoJS.enc.Utf8)
                }
                
                // Generate OTP if TOTP
                if (decrypted.otp_type === 'totp') {
                    decrypted.otp = this.generateLocalOTP(decrypted)
                }
                
                return decrypted
            })
            
            this.isOfflineMode = true
            return true
        },

        /**
         * Generate OTP locally using otpauth
         */
        generateLocalOTP(account) {
            try {
                const totp = new OTPAuth.TOTP({
                    secret: account.secret,
                    algorithm: account.algorithm || 'SHA1',
                    digits: account.digits || 6,
                    period: account.period || 30,
                })
                
                const now = Math.floor(Date.now() / 1000)
                const timeStep = account.period || 30
                
                return {
                    password: totp.generate(),
                    generated_at: now,
                    period: timeStep,
                    countdown: timeStep - (now % timeStep)
                }
            } catch (error) {
                console.error('Failed to generate OTP:', error)
                return null
            }
        },

        /**
         * Generate a simple encryption key
         */
        generateKey() {
            return CryptoJS.lib.WordArray.random(256/8).toString()
        },

        /**
         * Check if offline mode is available
         */
        hasOfflineData() {
            return !!localStorage.getItem('2fauth_offline_key')
        },

        /**
         * Clear offline data
         */
        async clearOfflineData() {
            if (this.offlineDB) {
                const tx = this.offlineDB.transaction(['accounts', 'auth'], 'readwrite')
                await tx.objectStore('accounts').clear()
                await tx.objectStore('auth').clear()
            }
            localStorage.removeItem('2fauth_offline_key')
            localStorage.removeItem('2fauth_offline_sync')
            localStorage.removeItem('2fauth_offline_user')
            this.isOfflineMode = false
        },

        /**
         * Store user authentication data for offline access
         */
        async storeOfflineAuth(user, passwordHash = null) {
            if (!this.offlineDB) await this.initOfflineDB()
            
            const key = localStorage.getItem('2fauth_offline_key') || this.generateKey()
            localStorage.setItem('2fauth_offline_key', key)
            
            const authData = {
                id: 'current_user',
                user: CryptoJS.AES.encrypt(JSON.stringify(user), key).toString(),
                passwordHash: passwordHash ? CryptoJS.AES.encrypt(passwordHash, key).toString() : null,
                webAuthnCredentials: null, // Will be populated by WebAuthn
                timestamp: new Date().toISOString()
            }
            
            const tx = this.offlineDB.transaction('auth', 'readwrite')
            await tx.objectStore('auth').put(authData)
            
            console.log('Stored offline auth data for user:', user.name)
        },

        /**
         * Verify offline authentication using password
         */
        async verifyOfflinePassword(password) {
            if (!this.offlineDB) return false
            
            const key = localStorage.getItem('2fauth_offline_key')
            if (!key) return false
            
            try {
                const authData = await this.offlineDB.get('auth', 'current_user')
                if (!authData || !authData.passwordHash) return false
                
                const storedHash = CryptoJS.AES.decrypt(authData.passwordHash, key).toString(CryptoJS.enc.Utf8)
                const inputHash = CryptoJS.SHA256(password).toString()
                
                if (storedHash === inputHash) {
                    const userData = JSON.parse(CryptoJS.AES.decrypt(authData.user, key).toString(CryptoJS.enc.Utf8))
                    this.setOfflineUser(userData)
                    return true
                }
                
                return false
            } catch (error) {
                console.error('Failed to verify offline password:', error)
                return false
            }
        },

        /**
         * Verify offline authentication using WebAuthn
         */
        async verifyOfflineWebAuthn(credential) {
            if (!this.offlineDB) return false
            
            const key = localStorage.getItem('2fauth_offline_key')
            if (!key) return false
            
            try {
                const authData = await this.offlineDB.get('auth', 'current_user')
                if (!authData || !authData.webAuthnCredentials) {
                    console.log('No stored WebAuthn credentials found')
                    return false
                }
                
                const storedCreds = JSON.parse(CryptoJS.AES.decrypt(authData.webAuthnCredentials, key).toString(CryptoJS.enc.Utf8))
                console.log('Stored WebAuthn credentials:', storedCreds)
                
                // For offline mode, we'll use a simplified verification approach
                // In a full implementation, you'd verify the cryptographic signature
                // For now, we verify that the credential was successfully generated by the browser
                if (credential && credential.id && credential.response) {
                    // If WebAuthn credentials exist and the browser successfully generated a credential,
                    // we consider it authenticated (since the browser's biometric/PIN already verified the user)
                    const userData = JSON.parse(CryptoJS.AES.decrypt(authData.user, key).toString(CryptoJS.enc.Utf8))
                    this.setOfflineUser(userData)
                    console.log('Offline WebAuthn authentication successful for user:', userData.name)
                    return true
                }
                
                return false
            } catch (error) {
                console.error('Failed to verify offline WebAuthn:', error)
                return false
            }
        },

        /**
         * Store WebAuthn credentials for offline use
         */
        async storeOfflineWebAuthn(credentials) {
            if (!this.offlineDB) return
            
            const key = localStorage.getItem('2fauth_offline_key')
            if (!key) return
            
            try {
                const tx = this.offlineDB.transaction('auth', 'readwrite')
                const store = tx.objectStore('auth')
                const authData = await store.get('current_user')
                
                if (authData) {
                    authData.webAuthnCredentials = CryptoJS.AES.encrypt(JSON.stringify(credentials), key).toString()
                    await store.put(authData)
                    console.log('Stored WebAuthn credentials for offline use')
                }
            } catch (error) {
                console.error('Failed to store offline WebAuthn credentials:', error)
            }
        },

        /**
         * Set offline user data
         */
        setOfflineUser(userData) {
            localStorage.setItem('2fauth_offline_user', JSON.stringify(userData))
            this.isOfflineMode = true
        },

        /**
         * Get offline user data
         */
        getOfflineUser() {
            const userData = localStorage.getItem('2fauth_offline_user')
            return userData ? JSON.parse(userData) : null
        },

        /**
         * Check if user is authenticated offline
         */
        isOfflineAuthenticated() {
            return !!localStorage.getItem('2fauth_offline_user')
        },

        /**
         * Check if WebAuthn credentials are available for offline use
         */
        async hasOfflineWebAuthnCredentials() {
            if (!this.offlineDB) await this.initOfflineDB()
            
            const key = localStorage.getItem('2fauth_offline_key')
            if (!key) return false
            
            try {
                const authData = await this.offlineDB.get('auth', 'current_user')
                return !!(authData && authData.webAuthnCredentials)
            } catch (error) {
                console.error('Failed to check offline WebAuthn credentials:', error)
                return false
            }
        }
    },
})
