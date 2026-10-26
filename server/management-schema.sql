-- Additive, repeatable migration. Does not read or modify personal plans.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_activity (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  last_seen_at DATETIME NOT NULL,
  CONSTRAINT user_activity_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_activity_days (
  user_id BIGINT UNSIGNED NOT NULL,
  active_date DATE NOT NULL,
  PRIMARY KEY (user_id, active_date),
  CONSTRAINT activity_days_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS feedback (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  message TEXT NOT NULL,
  status ENUM('new', 'read', 'resolved') NOT NULL DEFAULT 'new',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY feedback_created (created_at),
  KEY feedback_user (user_id),
  CONSTRAINT feedback_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS feedback_images (
  id CHAR(36) NOT NULL PRIMARY KEY,
  feedback_id BIGINT UNSIGNED NOT NULL,
  mime VARCHAR(32) NOT NULL,
  content MEDIUMBLOB NOT NULL,
  KEY feedback_images_feedback (feedback_id),
  CONSTRAINT feedback_images_fk FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB;
