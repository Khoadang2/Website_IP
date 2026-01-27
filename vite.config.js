const ldapService = require('../services/ldap.service');
const logger = require('../utils/logger');
const { sanitizeSQLInput } = require('../utils/sanitizer');

class PasswordController {
  /**
   * 🔐 RESET PASSWORD
   * POST /api/password/reset
   * Body: { username, newPassword, confirmPassword, note }
   */
  async resetPassword(req, res) {
    try {
      const { username, newPassword, confirmPassword, note } = req.body;

      // =============================
      // VALIDATION
      // =============================
      if (!username || !newPassword || !confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'Thiếu thông tin bắt buộc'
        });
      }

      const cleanUsername = sanitizeSQLInput(username.trim());
      const cleanNewPwd = newPassword.trim();
      const cleanConfirmPwd = confirmPassword.trim();

      if (cleanNewPwd !== cleanConfirmPwd) {
        return res.status(400).json({
          success: false,
          message: 'Mật khẩu mới và xác nhận không khớp'
        });
      }

      const validation = ldapService.validatePasswordStrength(cleanNewPwd);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.message
        });
      }

      // =============================
      // RESET PASSWORD
      // ✅ FIX: LUÔN LUÔN hiển thị mật khẩu mới (bỏ qua note từ frontend)
      // =============================
      const resetNote = cleanNewPwd;

      const result = await ldapService.adminResetPassword(
        cleanUsername,
        cleanNewPwd,
        resetNote
      );

      logger.info(`✅ Reset password success: ${cleanUsername}`, {
        username: cleanUsername,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        message: result.message
      });

    } catch (error) {
      logger.error('❌ Reset password error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * 🔍 VALIDATE PASSWORD STRENGTH
   * POST /api/password/validate
   * Body: { password }
   */
  async validatePassword(req, res) {
    try {
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Thiếu mật khẩu cần kiểm tra'
        });
      }

      const validation = ldapService.validatePasswordStrength(password);

      res.json({
        success: true,
        data: validation
      });

    } catch (error) {
      logger.error('Validate password error:', error);
      res.status(500).json({
        success: false,
        message: 'Lỗi kiểm tra mật khẩu'
      });
    }
  }
}

module.exports = new PasswordController();
