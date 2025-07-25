use anchor_lang::prelude::*;

declare_id!("7BrNnbcYfbafKnp8BDu1SSUwBDXLB2QBfr4KEKyFfnqK");

#[program]
pub mod solana_anchor_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
