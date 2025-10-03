use solana_security_txt::security_txt;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    system_instruction,
    program::{invoke, invoke_signed},
};

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    // Name of the Project
    name: "Embedded",

    // Project Homepage
    project_url: "https://embedded.games",

    // Contact Methods
    contacts: "mailto:embedded.psylabs@gmail.com",

    // Public disclosure policy URL
    policy: "https://embedded.games",

    // Team Preferred Languages
    preferred_languages: "en,es"
}

declare_id!("BUQFRUJECRCADvdtStPUgcBgnvcNZhSWbuqBraPWPKf8");

#[program]
pub mod embedded {
    use super::*;

    /// Initialize config (admin only)
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        casual_bet_lamports: u64,
        casual_fee_bps: u16,
        betting_fee_bps: u16,
        winners_mode_is_percentage: bool,
        winners_value: u16, // If winners_mode_is_percentage is false, then int (500), else percentage (0-100)
        reward_percentage_bps: u16,
    ) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        cfg.authority = *ctx.accounts.authority.key;
        cfg.casual_bet = casual_bet_lamports;
        cfg.casual_fee_bps = casual_fee_bps;
        cfg.betting_fee_bps = betting_fee_bps;
        cfg.winners_mode_is_percentage = winners_mode_is_percentage;
        cfg.winners_value = winners_value;
        cfg.reward_percentage_bps = reward_percentage_bps;
        cfg.bump = ctx.bumps.config;

        // Initialize treasury PDA
        let treasury = &mut ctx.accounts.treasury;
        treasury.bump = ctx.bumps.treasury;
        Ok(())
    }

    /// Initialize treasury bump (admin only)
    pub fn initialize_treasury_bump(ctx: Context<InitializeTreasuryBump>) -> Result<()> {
        require_keys_eq!(ctx.accounts.config.authority, *ctx.accounts.authority.key, CustomError::Unauthorized);

        let (_pda, bump) = Pubkey::find_program_address(&[b"treasury"], ctx.program_id);
        ctx.accounts.treasury.bump = bump;
        Ok(())
    }

    /// Update config values (admin only)
    pub fn update_config(ctx: Context<UpdateConfig>, new_cfg: UpdateConfigParams) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require_keys_eq!(cfg.authority, *ctx.accounts.authority.key, CustomError::Unauthorized);
        if let Some(cfb) = new_cfg.casual_fee_bps { cfg.casual_fee_bps = cfb; }
        if let Some(bfb) = new_cfg.betting_fee_bps { cfg.betting_fee_bps = bfb; }
        if let Some(wm) = new_cfg.winners_mode_is_percentage { cfg.winners_mode_is_percentage = wm; }
        if let Some(wv) = new_cfg.winners_value { cfg.winners_value = wv; }
        if let Some(rpb) = new_cfg.reward_percentage_bps { cfg.reward_percentage_bps = rpb; }
        Ok(())
    }

    /// User pays entry (signed by user). Funds are transferred into the match PDA (program-owned).
    pub fn pay_entry(ctx: Context<PayEntry>, amount: u64) -> Result<()> {
        // Transfer lamports from payer -> treasury PDA
        let ix = system_instruction::transfer(
            ctx.accounts.payer.key,
            ctx.accounts.treasury.to_account_info().key,
            amount,
        );

        invoke(
            &ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Emit deposit event
        let now = Clock::get()?.unix_timestamp;
        emit!(DepositEvent {
            payer: *ctx.accounts.payer.key,
            amount,
            ts: now,
        });

        Ok(())
    }

    /// Settle a finished match: pays winner and moves fees to treasury
    /// Requires that the match PDA currently holds the funds
    /// Admin only (config authority)
    pub fn settle_match(
        ctx: Context<SettleMatch>,
        match_id: String,
        total_amount: u64,
        total_fee: u64,
        mode: MatchMode,
        winner: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.config.authority, *ctx.accounts.authority.key, CustomError::Unauthorized);

        // Funds check
        let treasury_balance = ctx.accounts.treasury.to_account_info().lamports();
        require!(treasury_balance >= total_amount, CustomError::InsufficientFunds);

        // Compute total fee and winner amount
        let winner_amount_u128 = (total_amount as u128).checked_sub(total_fee as u128).ok_or(CustomError::MathOverflow)?;
        let winner_amount = winner_amount_u128 as u64;

        // Ensure treasury has enough lamports
        let treasury_info = ctx.accounts.treasury.to_account_info();
        require!(treasury_info.lamports() >= total_amount, CustomError::InsufficientFunds);

        // Destination account
        let dest_info = ctx.accounts.winner.to_account_info();

        // Ensure the destination matches expected winner pubkey
        require_keys_eq!(dest_info.key(), winner, CustomError::Unauthorized);

        // Move lamports by mutating lamports directly (safe because program owns treasury)
        {
            let mut from_lamports = treasury_info.try_borrow_mut_lamports()?;
            let mut to_lamports = dest_info.try_borrow_mut_lamports()?;

            // read current balances (copy values)
            let from_balance: u64 = **from_lamports;
            let to_balance: u64 = **to_lamports;

            // compute new balances
            let new_from = from_balance
                .checked_sub(winner_amount)
                .ok_or(CustomError::InsufficientFunds)?;
            let new_to = to_balance
                .checked_add(winner_amount)
                .ok_or(CustomError::MathOverflow)?;

            // write back using double-deref into the RefMut
            **from_lamports = new_from;
            **to_lamports = new_to;
        }

        // Emit settle event
        let now = Clock::get()?.unix_timestamp;
        emit!(SettleEvent {
            match_id,
            total_amount,
            total_fee,
            mode: mode.clone(),
            winner,
            ts: now,
        });

        Ok(())
    }

    /// Distribute rewards from treasury based on winners array (points-based).
    /// Admin Only (config authority)
    pub fn distribute_rewards<'info>(
        ctx: Context<'_, '_, '_, 'info, DistributeRewards<'info>>,
        winners: Vec<WinnerInput>,
        insiders: Vec<InsiderInput>
    ) -> Result<()> {
        require_keys_eq!(ctx.accounts.config.authority, *ctx.accounts.authority.key, CustomError::Unauthorized);

        // Treasury balance (lamports)
        let treasury_lamports = ctx.accounts.treasury.to_account_info().lamports() as u128;
        let cfg = &ctx.accounts.config;

        // Reward pool = treasury * reward_percentage_bps / 10000
        let reward_pool = (treasury_lamports * (cfg.reward_percentage_bps as u128)) / 10_000u128;

        // Sum points
        let total_points: u128 = winners.iter().map(|w| w.points as u128).sum();
        require!(total_points > 0, CustomError::NoPoints);

        // Ensure remaining_accounts length is enough:
        let winners_count = winners.len();
        let insiders_count = insiders.len();
        let expected_accounts = winners_count + insiders_count;
        require!(
            ctx.remaining_accounts.len() >= expected_accounts,
            CustomError::MissingRemainingAccounts
        );

        // Treasury PDA seeds
        let treasury_bump = ctx.accounts.treasury.bump;
        let seeds: &[&[u8]] = &[b"treasury", &[treasury_bump]];

        // Distribute to winners
        let mut distributed: u128 = 0;
        
        for (i, w) in winners.iter().enumerate() {
            // Calculate share
            let share = (reward_pool * (w.points as u128)) / total_points;
            if share == 0 {
                continue;
            }

            let dest_info = &ctx.remaining_accounts[i];

            if dest_info.key != &w.wallet {
                return Err(error!(CustomError::Unauthorized));
            }

            // Transfer share from treasury to winner
            let ix = system_instruction::transfer(
                ctx.accounts.treasury.to_account_info().key,
                dest_info.key,
                share as u64,
            );
            anchor_lang::solana_program::program::invoke_signed(
                &ix,
                &[
                    ctx.accounts.treasury.to_account_info(),
                    dest_info.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[seeds],
            )?;

            distributed = distributed.checked_add(share).ok_or(CustomError::MathOverflow)?;
        }

        let remaining_after_winners = treasury_lamports
            .checked_sub(distributed)
            .ok_or(CustomError::MathOverflow)?;

        if remaining_after_winners == 0 || insiders_count == 0 {
            return Ok(());
        }

        // Validate insider shares
        let mut sum_shares_bps: u128 = 0;
        for ins in insiders.iter() {
            sum_shares_bps = sum_shares_bps
                .checked_add(ins.share_bps as u128)
                .ok_or(CustomError::MathOverflow)?;
        }
        require!(sum_shares_bps <= 10_000u128, CustomError::InvalidInsiderShares);

        // Transfer winnings to insiders
        let mut allocated_insiders: u128 = 0;
        for (j, ins) in insiders.iter().enumerate() {
            let dest_idx = winners_count + j;
            let dest_info = &ctx.remaining_accounts[dest_idx];

            if dest_info.key != &ins.wallet {
                return Err(error!(CustomError::Unauthorized));
            }

            // Compute share
            let amount = (remaining_after_winners * (ins.share_bps as u128)) / 10_000u128;
            if amount == 0 {
                continue;
            }

            let ix = system_instruction::transfer(
                ctx.accounts.treasury.to_account_info().key,
                dest_info.key,
                amount as u64,
            );

            anchor_lang::solana_program::program::invoke_signed(
                &ix,
                &[
                    ctx.accounts.treasury.to_account_info(),
                    dest_info.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[seeds],
            )?;

            allocated_insiders = allocated_insiders.checked_add(amount).ok_or(CustomError::MathOverflow)?;
        }

        // Emit distributed rewards event
        emit!(DistributedRewardsEvent {
            distributed_reward_pool: distributed as u64,
            ts: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

/// Refund an entry fee from the treasury to a player
/// Admin-only (config authority)
pub fn refund_entry(
    ctx: Context<RefundEntry>,
    match_id: String,
    player: Pubkey,
    amount: u64,
) -> Result<()> {
    // Only the configured authority can refund
    require_keys_eq!(
        ctx.accounts.config.authority,
        *ctx.accounts.authority.key,
        CustomError::Unauthorized
    );

    // Passed account must match the provided player pubkey
    require_keys_eq!(ctx.accounts.player.key(), player, CustomError::Unauthorized);

    // Check sufficient funds
    let treasury_info = ctx.accounts.treasury.to_account_info();
    require!(treasury_info.lamports() >= amount, CustomError::InsufficientFunds);

    // Player info
    let dest_info = ctx.accounts.player.to_account_info();

    // Move lamports by mutating lamports directly (safe because program owns treasury)
    {
        let mut from_lamports = treasury_info.try_borrow_mut_lamports()?;
        let mut to_lamports = dest_info.try_borrow_mut_lamports()?;

        // read current balances (copy values)
        let from_balance: u64 = **from_lamports;
        let to_balance: u64 = **to_lamports;

        // compute new balances
        let new_from = from_balance
            .checked_sub(amount)
            .ok_or(CustomError::InsufficientFunds)?;
        let new_to = to_balance
            .checked_add(amount)
            .ok_or(CustomError::MathOverflow)?;

        // write back using double-deref into the RefMut
        **from_lamports = new_from;
        **to_lamports = new_to;
    }

    // Emit event
    emit!(RefundEvent {
        match_id,
        player,
        amount,
        ts: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// ---------- Contexts & Accounts ----------

#[derive(Accounts)]
#[instruction(casual_bet_lamports: u64, casual_fee_bps: u16, betting_fee_bps: u16, winners_mode_is_percentage: bool, winners_value: u16, reward_percentage_bps: u16)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = authority, space = 8 + Config::MAX_SIZE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,

    // Treasury PDA
    #[account(init, payer = authority, space = 8 + Treasury::MAX_SIZE, seeds = [b"treasury"], bump)]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
pub struct InitializeTreasuryBump<'info> {
    #[account(mut, seeds=[b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds=[b"treasury"], bump)]
    pub treasury: Account<'info, Treasury>,

    pub authority: Signer<'info>,
}


#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds=[b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct PayEntry<'info> {
    #[account(mut, seeds = [b"treasury"], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds = [b"treasury"], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,

    /// CHECK: We only use the winner account to transfer funds into it.
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DistributeRewards<'info> {
    #[account(mut, seeds=[b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds=[b"treasury"], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundEntry<'info> {
    #[account(mut, seeds=[b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(mut, seeds=[b"treasury"], bump = treasury.bump)]
    pub treasury: Account<'info, Treasury>,

    /// CHECK: destination of the refund; only used to receive lamports
    #[account(mut)]
    pub player: UncheckedAccount<'info>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// ---------- Data structs ----------

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub casual_bet: u64,
    pub casual_fee_bps: u16,
    pub betting_fee_bps: u16,
    pub winners_mode_is_percentage: bool,
    pub winners_value: u16,
    pub reward_percentage_bps: u16,
    pub bump: u8,
}

impl Config {
    pub const MAX_SIZE: usize = 32 + 8 + 2 + 2 + 1 + 2 + 2 + 1;
}

#[account]
pub struct Treasury {
    pub bump: u8,
}

impl Treasury {
    pub const MAX_SIZE: usize = 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WinnerInput {
    pub wallet: Pubkey,
    pub points: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InsiderInput {
    pub wallet: Pubkey,
    pub share_bps: u16, // 10000 == 100%
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateConfigParams {
    pub casual_fee_bps: Option<u16>,
    pub betting_fee_bps: Option<u16>,
    pub winners_mode_is_percentage: Option<bool>,
    pub winners_value: Option<u16>,
    pub reward_percentage_bps: Option<u16>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum MatchMode {
    Casual,
    Betting,
}

/// ---------- Events ----------

#[event]
pub struct DepositEvent {
    pub payer: Pubkey,
    pub amount: u64,
    pub ts: i64,
}

#[event]
pub struct SettleEvent {
    pub match_id: String,
    pub total_amount: u64,
    pub total_fee: u64,
    pub mode: MatchMode,
    pub winner: Pubkey,
    pub ts: i64,
}

#[event]
pub struct DistributedRewardsEvent {
    pub distributed_reward_pool: u64,
    pub ts: i64,
}

#[event]
pub struct RefundEvent {
    pub match_id: String,
    pub player: Pubkey,
    pub amount: u64,
    pub ts: i64,
}

/// ---------- Errors ----------
#[error_code]
pub enum CustomError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient funds in treasury")]
    InsufficientFunds,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("No points")]
    NoPoints,
    #[msg("Insider shares exceed 100% (10000 bps)")]
    InvalidInsiderShares,
    #[msg("Not enough remaining accounts passed for winners/insiders")]
    MissingRemainingAccounts,
}