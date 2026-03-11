/**
 * A reference to a specific message in a specific account.
 * Always use this type — never pass bare UIDs.
 * account_id matches the `name` field in config.
 */
export interface MessageRef {
  account_id: string;
  uid: number;
}

/**
 * A reference to a named account.
 * account_id matches the `name` field in config.
 */
export interface AccountRef {
  account_id: string;
}
