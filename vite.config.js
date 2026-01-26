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
  }

  /**
   * 🔌 KẾT NỐI LDAP (LDAPS BẮT BUỘC) - CÓ AUTO RECONNECT
   */
  async connect() {
    if (this.isConnected && this.client) {
      return this.client;
    }

    return new Promise((resolve, reject) => {
      // Đóng client cũ nếu có
      if (this.client) {
        try {
          this.client.unbind(() => {});
        } catch (e) {
          logger.warn('Failed to unbind old client:', e.message);
        }
        this.client = null;
      }

      this.client = ldap.createClient({
        url: config.url,
        tlsOptions: config.tlsOptions,
        timeout: config.timeout,
        connectTimeout: config.connectTimeout,
        idleTimeout: config.idleTimeout,
        reconnect: true // ✅ BẬT AUTO RECONNECT
      });

      this.client.bind(config.bindDN, config.bindPassword, (err) => {
        if (err) {
          logger.error('❌ LDAP bind failed:', err);
          this.isConnected = false;
          this.client = null;
          return reject(new Error('Không thể bind LDAP: ' + err.message));
        }

        this.isConnected = true;
        this.reconnectAttempts = 0;
        logger.info('✅ LDAP connected (LDAPS)');
        resolve(this.client);
      });

      // ✅ XỬ LÝ LỖI RECONNECT TỰ ĐỘNG
      this.client.on('error', async (err) => {
        logger.error('LDAP client error:', err);
        this.isConnected = false;

        // Nếu là lỗi connection reset, thử reconnect
        if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
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
          }
        }
      });

      // ✅ XỬ LÝ KHI CONNECTION ĐÓNG
      this.client.on('close', () => {
        logger.warn('⚠️ LDAP connection closed');
        this.isConnected = false;
      });
    });
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
   * 🔐 ADMIN RESET PASSWORD - CÓ RETRY
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

  // 4️⃣ Reset password
  await new Promise((resolve, reject) => {
    this.client.modify(
      userDN,
      new ldap.Change({
        operation: 'replace',
        modification: {
          unicodePwd: encodedPwd
        }
      }),
      (err) => {
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
            return reject(new Error('Active Directory từ chối reset password (WILL_NOT_PERFORM)'));
          }

          return reject(err);
        }

        logger.info(`✅ Password reset OK for ${username}`);
        resolve();
      }
    );
  });

  // 5️⃣ Update description (không ảnh hưởng kết quả reset)
  if (note && note.trim()) {
    try {
      await new Promise((resolve) => {
        this.client.modify(
          userDN,
          new ldap.Change({
            operation: 'replace',
            modification: { description: note }
          }),
          () => resolve()
        );
      });
    } catch (e) {
      logger.warn('⚠️ Update description failed:', e.message);
    }
  }

  return {
    success: true,
    message: 'Reset password thành công'
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
    if (this.client) {
      try {
        this.client.unbind((err) => {
          if (err) {
            logger.error('Error unbinding LDAP:', err);
          }
        });
      } catch (e) {
        logger.warn('Unbind error:', e.message);
      }
      this.isConnected = false;
      this.client = null;
      logger.info('LDAP disconnected');
    }
  }
}

module.exports = new LDAPService();
