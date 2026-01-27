const ldap = require('ldapjs');
const logger = require('../utils/logger');
const config = require('../config/ldap');

class LDAPService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 2000;
    this.keepAliveTimer = null;
    this.isReconnecting = false; // ✅ FIX: Prevent duplicate reconnection attempts
  }

  /**
   * 🔌 KẾT NỐI LDAP (LDAPS BẮT BUỘC) - CÓ AUTO RECONNECT
   */
  async connect() {
    if (this.isConnected && this.client) {
      return this.client;
    }

    // ✅ FIX: Prevent duplicate reconnection attempts
    if (this.isReconnecting) {
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (this.isConnected && this.client) {
            clearInterval(checkInterval);
            resolve(this.client);
          } else if (!this.isReconnecting) {
            clearInterval(checkInterval);
            reject(new Error('Reconnection failed'));
          }
        }, 500);
      });
    }

    this.isReconnecting = true;

    return new Promise((resolve, reject) => {
      // Đóng client cũ nếu có
      if (this.client) {
        try {
          this.client.unbind(() => {});
          this.client.destroy(); // ✅ FIX: Properly destroy old connection
        } catch (e) {
          logger.warn('Failed to unbind old client:', e.message);
        }
        this.client = null;
      }

      // Dừng keep-alive timer cũ
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }

      this.client = ldap.createClient({
        url: config.url,
        tlsOptions: config.tlsOptions,
        timeout: config.timeout,
        connectTimeout: config.connectTimeout,
        idleTimeout: config.idleTimeout || 900000, // ✅ FIX: Set idle timeout to 15 minutes (default)
        reconnect: false // ✅ FIX: Disable built-in reconnect, we handle it manually
      });

      // ✅ FIX: Setup error handlers BEFORE binding
      this.setupEventHandlers();

      this.client.bind(config.bindDN, config.bindPassword, (err) => {
        this.isReconnecting = false;

        if (err) {
          logger.error('❌ LDAP bind failed:', err);
          this.isConnected = false;
          this.client = null;
          return reject(new Error('Không thể bind LDAP: ' + err.message));
        }

        this.isConnected = true;
        this.reconnectAttempts = 0;
        logger.info('✅ LDAP connected (LDAPS)');

        // Bật keep-alive
        this.startKeepAlive();

        resolve(this.client);
      });
    });
  }

  /**
   * ✅ FIX: Setup event handlers separately to avoid duplicate handlers
   */
  setupEventHandlers() {
    if (!this.client) return;

    // Remove old listeners
    this.client.removeAllListeners('error');
    this.client.removeAllListeners('close');
    this.client.removeAllListeners('timeout');

    // Xử lý lỗi reconnect tự động
    this.client.on('error', async (err) => {
      logger.error('LDAP client error:', {
        code: err.code,
        errno: err.errno,
        syscall: err.syscall,
        message: err.message
      });
      
      this.isConnected = false;

      // Dừng keep-alive khi có lỗi
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }

      // Nếu là lỗi connection reset, thử reconnect
      if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
        // ✅ FIX: Prevent duplicate reconnection attempts
        if (this.isReconnecting) {
          return;
        }

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          logger.warn(`🔄 Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
          
          setTimeout(async () => {
            try {
              await this.connect();
              logger.info('✅ Reconnected successfully');
            } catch (e) {
              logger.error('❌ Reconnect failed:', e.message);
            }
          }, this.reconnectDelay * this.reconnectAttempts);
        } else {
          logger.error('❌ Max reconnect attempts reached');
          this.reconnectAttempts = 0; // ✅ FIX: Reset counter for next attempt
        }
      }
    });

    // Xử lý khi connection đóng
    this.client.on('close', (hadError) => {
      logger.warn('⚠️ LDAP connection closed', { hadError });
      this.isConnected = false;
      
      // Dừng keep-alive
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
    });

    // ✅ FIX: Handle timeout events
    this.client.on('timeout', (err) => {
      logger.warn('⚠️ LDAP connection timeout');
      this.isConnected = false;
    });
  }

  /**
   * ✅ FIX: KEEP-ALIVE with shorter interval (10 minutes instead of 10 minutes)
   * Also changed from 10 minutes to 8 minutes to prevent timeout at 16 minutes
   */
  startKeepAlive() {
    // Clear timer cũ nếu có
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
    }

    // ✅ FIX: Gửi ping mỗi 8 phút để tránh idle timeout 16 phút
    const KEEP_ALIVE_INTERVAL = 8 * 60 * 1000; // 8 minutes

    this.keepAliveTimer = setInterval(async () => {
      if (this.isConnected && this.client) {
        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Keep-alive timeout'));
            }, 5000);

            this.client.search(
              config.baseDN,
              {
                scope: 'base',
                filter: '(objectClass=*)',
                attributes: ['dn'],
                sizeLimit: 1
              },
              (err, res) => {
                if (err) {
                  clearTimeout(timeout);
                  return reject(err);
                }
                
                res.on('end', () => {
                  clearTimeout(timeout);
                  resolve();
                });
                
                res.on('error', (err) => {
                  clearTimeout(timeout);
                  reject(err);
                });
              }
            );
          });
          logger.debug('✅ Keep-alive ping sent');
        } catch (err) {
          logger.warn('⚠️ Keep-alive ping failed:', err.message);
          // ✅ FIX: Mark as disconnected to trigger reconnection on next operation
          this.isConnected = false;
        }
      }
    }, KEEP_ALIVE_INTERVAL);

    logger.info(`✅ Keep-alive started (interval: ${KEEP_ALIVE_INTERVAL / 1000}s)`);
  }

  /**
   * 🔍 TÌM DN USER - CÓ RETRY
   */
  async findUserDN(username) {
    let retries = 2;
    let lastError;

    while (retries > 0) {
      try {
        await this.connect();

        return await new Promise((resolve, reject) => {
          const opts = {
            scope: 'sub',
            filter: `(&(objectClass=user)(objectCategory=person)(sAMAccountName=${username}))`,
            attributes: ['distinguishedName']
          };

          let userDN = null;

          this.client.search(config.baseDN, opts, (err, res) => {
            if (err) {
              return reject(err);
            }

            res.on('searchEntry', (entry) => {
              userDN = entry.objectName;
            });

            res.on('error', (err) => reject(err));

            res.on('end', () => {
              if (!userDN) {
                reject(new Error('Không tìm thấy user trong domain'));
              } else {
                resolve(userDN);
              }
            });
          });
        });
      } catch (error) {
        lastError = error;
        retries--;
        
        if (retries > 0) {
          logger.warn(`Retry findUserDN, ${retries} attempts left`);
          this.isConnected = false;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    throw lastError;
  }

  /**
   * 🔐 KIỂM TRA ĐỘ MẠNH PASSWORD
   */
  validatePasswordStrength(password) {
    if (!password || password.length === 0) {
      return { valid: false, message: 'Mật khẩu không được để trống' };
    }

    if (password.length < 6) {
      return { valid: false, message: 'Mật khẩu phải có ít nhất 6 ký tự' };
    }

    return { valid: true, message: '' };
  }

  /**
   * 🔐 ADMIN RESET PASSWORD - BẮT BUỘC ĐỔI MẬT KHẨU LẦN ĐẦU
   */
  async adminResetPassword(username, newPassword, note = '') {
    const validation = this.validatePasswordStrength(newPassword);
    if (!validation.valid) {
      throw new Error(validation.message);
    }

    // 1️⃣ Tìm DN user
    const userDN = await this.findUserDN(username);

    // 2️⃣ Kết nối LDAP (bind bằng admin)
    await this.connect();

    // 3️⃣ Encode password chuẩn AD
    const encodedPwd = Buffer.from(`"${newPassword}"`, 'utf16le');

    // 4️⃣ Reset password + Force change at next logon
    const changes = [
      new ldap.Change({
        operation: 'replace',
        modification: {
          unicodePwd: encodedPwd
        }
      }),
      new ldap.Change({
        operation: 'replace',
        modification: {
          pwdLastSet: '0'  // ✅ BẮT BUỘC USER ĐỔI MẬT KHẨU LẦN ĐẦU ĐĂNG NHẬP
        }
      })
    ];

    await new Promise((resolve, reject) => {
      this.client.modify(userDN, changes, (err) => {
        if (err) {
          logger.error('❌ Reset password failed', {
            user: username,
            dn: userDN,
            code: err.code,
            message: err.message
          });

          // ❌ Quyền không đủ
          if (err.code === 50) {
            return reject(new Error('Không đủ quyền reset password'));
          }

          // ❌ Vi phạm policy
          if (err.code === 19) {
            return reject(new Error('Password không đạt policy domain'));
          }

          // ❌ LDAPS / AD từ chối
          if (err.code === 53) {
            return reject(new Error('Phải sử dụng LDAPS để đổi password'));
          }

          return reject(new Error(`Lỗi reset password: ${err.message}`));
        }

        logger.info(`✅ Password reset OK for ${username} (forced change at next logon)`);
        resolve();
      });
    });

    // 5️⃣ Validate password đã reset
    logger.info('✅ Password reset validated successfully');

    // 6️⃣ Update description (note) - không bắt buộc
    if (note) {
      try {
        await new Promise((resolve, reject) => {
          const descChange = new ldap.Change({
            operation: 'replace',
            modification: {
              description: note
            }
          });

          this.client.modify(
            userDN,
            [descChange],
            (err) => {
              if (err) return reject(err);
              resolve();
            }
          );
        });
        logger.info(`✅ Updated description for ${username}`);
      } catch (e) {
        logger.warn('⚠️ Update description failed:', e.message);
      }
    }

    // ✅ FIX: Proper logging with structured data
    logger.info(`✅ Reset password success: ${username}`, {
      username,
      hasNote: !!note,
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      message: 'Reset password thành công. User phải đổi mật khẩu tại lần đăng nhập tiếp theo.'
    };
  }

  /**
   * 🔍 TÌM KIẾM USERS - CÓ RETRY
   */
  async search(filter = config.searchOptions.filter, attributes = config.searchOptions.attributes) {
    let retries = 2;
    let lastError;

    while (retries > 0) {
      try {
        await this.connect();

        return await new Promise((resolve, reject) => {
          const entries = [];

          this.client.search(
            config.baseDN,
            {
              scope: config.searchOptions.scope,
              filter,
              attributes,
              paged: config.searchOptions.paged,
              sizeLimit: config.searchOptions.sizeLimit
            },
            (err, res) => {
              if (err) {
                logger.error('LDAP search error:', err);
                return reject(new Error('Lỗi tìm kiếm LDAP'));
              }

              res.on('searchEntry', (entry) => {
                entries.push(entry);
              });

              res.on('error', (err) => {
                logger.error('LDAP search stream error:', err);
                reject(new Error('Lỗi stream LDAP'));
              });

              res.on('end', () => {
                logger.info(`LDAP search completed: ${entries.length} entries found`);
                resolve(entries);
              });
            });
        });
      } catch (error) {
        lastError = error;
        retries--;
        
        if (retries > 0) {
          logger.warn(`Retry search, ${retries} attempts left`);
          this.isConnected = false;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    throw lastError;
  }

  /**
   * 📋 LẤY TẤT CẢ USERS
   */
  async getAllUsers(isAPITool = false) {
    try {
      const entries = await this.search();

      return entries
        .map(entry => {
          let attrs = {};

          if (entry.pojo && entry.pojo.attributes) {
            attrs = entry.pojo.attributes.reduce((acc, attr) => {
              if (attr.values && attr.values.length > 0) {
                acc[attr.type] = attr.values[0];
              }
              return acc;
            }, {});
          } else if (entry.object) {
            attrs = entry.object;
          } else if (entry.attributes) {
            attrs = entry.attributes.reduce((acc, attr) => {
              if (attr.values && attr.values.length > 0) {
                acc[attr.type] = attr.values[0];
              }
              return acc;
            }, {});
          }

          if (isAPITool) {
            return {
              username: attrs.sAMAccountName || 'N/A',
              displayName: attrs.displayName || null
            };
          }

          return {
            username: attrs.sAMAccountName || 'N/A',
            displayName: attrs.displayName || null,
            email: attrs.mail || null,
            phone: attrs.telephoneNumber || null,
            mobile: attrs.mobile || null,
            title: attrs.title || null,
            department: attrs.department || null,
            company: attrs.company || null,
            description: attrs.description || 'Không có ghi chú'
          };
        })
        .filter(user => user.username !== 'N/A');

    } catch (error) {
      logger.error('Error getting LDAP users:', error);
      throw error;
    }
  }

  /**
   * 🔍 TÌM KIẾM USERS THEO TỪ KHÓA
   */
  async searchUsers(query, isAPITool = false) {
    const filter = `(&(objectClass=user)(objectCategory=person)(|(sAMAccountName=*${query}*)(displayName=*${query}*)(mail=*${query}*)))`;

    try {
      const entries = await this.search(filter);

      return entries
        .filter(entry => entry && entry.pojo && entry.pojo.attributes)
        .map(entry => {
          const attrs = entry.pojo.attributes.reduce((acc, attr) => {
            if (attr.values && attr.values.length > 0) {
              acc[attr.type] = attr.values[0];
            }
            return acc;
          }, {});

          if (isAPITool) {
            return {
              username: attrs.sAMAccountName || 'N/A',
              displayName: attrs.displayName || null
            };
          }

          return {
            username: attrs.sAMAccountName || 'N/A',
            displayName: attrs.displayName || null,
            email: attrs.mail || null,
            phone: attrs.telephoneNumber || null,
            mobile: attrs.mobile || null,
            title: attrs.title || null,
            department: attrs.department || null,
            company: attrs.company || null,
            description: attrs.description || 'Không có ghi chú'
          };
        })
        .filter(user => user.username !== 'N/A');

    } catch (error) {
      logger.error('Error searching LDAP users:', error);
      throw error;
    }
  }

  /**
   * 🔐 XÁC THỰC USER
   */
  async authenticate(username, password) {
    try {
      const domain = config.baseDN
        .split(',')
        .filter(part => part.startsWith('DC='))
        .map(part => part.replace('DC=', ''))
        .join('.');

      const upn = `${username}@${domain}`;

      logger.info(`Attempting authentication for user: ${username}`);

      return new Promise(async (resolve, reject) => {
        const authClient = ldap.createClient({
          url: config.url,
          timeout: config.timeout,
          connectTimeout: config.connectTimeout,
          tlsOptions: config.tlsOptions
        });

        authClient.bind(upn, password, async (err) => {
          if (!err) {
            logger.info(`✅ Authentication successful: ${username}`);
            authClient.unbind();
            return resolve(true);
          }

          logger.warn(`UPN auth failed, trying DN lookup...`);

          try {
            const userDN = await this.findUserDN(username);

            const dnAuthClient = ldap.createClient({
              url: config.url,
              timeout: config.timeout,
              connectTimeout: config.connectTimeout,
              tlsOptions: config.tlsOptions
            });

            dnAuthClient.bind(userDN, password, (dnErr) => {
              dnAuthClient.unbind();

              if (dnErr) {
                logger.error(`❌ Auth failed: ${username}`);
                reject(new Error('Invalid Credentials'));
              } else {
                logger.info(`✅ Auth successful (DN): ${username}`);
                resolve(true);
              }
            });

          } catch (findErr) {
            authClient.unbind();
            logger.error(`❌ User not found: ${username}`);
            reject(new Error('User not found'));
          }
        });

        setTimeout(() => {
          authClient.unbind();
          reject(new Error('Authentication timeout'));
        }, config.timeout);
      });

    } catch (error) {
      logger.error('Authentication error:', error);
      throw error;
    }
  }

  /**
   * 🔌 ĐÓNG KẾT NỐI
   */
  disconnect() {
    // Dừng keep-alive timer
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }

    if (this.client) {
      try {
        this.client.unbind((err) => {
          if (err) {
            logger.error('Error unbinding LDAP:', err);
          }
        });
        this.client.destroy(); // ✅ FIX: Properly destroy connection
      } catch (e) {
        logger.warn('Unbind error:', e.message);
      }
      this.isConnected = false;
      this.client = null;
      logger.info('LDAP disconnected');
    }
  }

  /**
   * ✅ NEW: Get connection status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      hasKeepAlive: !!this.keepAliveTimer
    };
  }
}

module.exports = new LDAPService();
