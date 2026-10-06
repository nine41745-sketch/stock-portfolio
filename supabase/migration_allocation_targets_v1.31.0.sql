-- v1.31.0 Portfolio Target Allocation + Rebalance
-- Additive schema: one target table + one service-role-only atomic snapshot RPC.

CREATE TABLE IF NOT EXISTS public.portfolio_allocation_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  asset_key TEXT NOT NULL,
  target_pct NUMERIC(7,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT portfolio_allocation_targets_asset_key_check
    CHECK (asset_key = 'DIME' OR asset_key ~ '^[A-Z0-9][A-Z0-9.-]{0,14}$'),
  CONSTRAINT portfolio_allocation_targets_pct_check
    CHECK (target_pct >= 0 AND target_pct <= 100),
  CONSTRAINT portfolio_allocation_targets_unique
    UNIQUE (user_id, portfolio_id, asset_key)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_allocation_targets_portfolio
  ON public.portfolio_allocation_targets (user_id, portfolio_id);

ALTER TABLE public.portfolio_allocation_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portfolio_allocation_targets_select_own ON public.portfolio_allocation_targets;
CREATE POLICY portfolio_allocation_targets_select_own
ON public.portfolio_allocation_targets
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.portfolios p
    WHERE p.id = portfolio_id
      AND p.user_id = auth.uid()
  )
);

REVOKE ALL ON TABLE public.portfolio_allocation_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.portfolio_allocation_targets TO authenticated;

CREATE OR REPLACE FUNCTION public.save_portfolio_allocation_targets(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_targets JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item JSONB;
  v_key TEXT;
  v_pct NUMERIC;
  v_sum NUMERIC := 0;
  v_count INTEGER := 0;
  v_seen JSONB := '{}'::JSONB;
BEGIN
  IF p_user_id IS NULL OR p_portfolio_id IS NULL THEN
    RAISE EXCEPTION 'required allocation input missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.portfolios p
    WHERE p.id = p_portfolio_id
      AND p.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'portfolio not found';
  END IF;

  IF p_targets IS NULL OR jsonb_typeof(p_targets) <> 'array' THEN
    RAISE EXCEPTION 'targets must be an array';
  END IF;

  IF jsonb_array_length(p_targets) < 1 OR jsonb_array_length(p_targets) > 50 THEN
    RAISE EXCEPTION 'targets count out of range';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_targets)
  LOOP
    v_key := UPPER(BTRIM(COALESCE(v_item->>'asset_key', '')));
    BEGIN
      v_pct := (v_item->>'target_pct')::NUMERIC;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid target percentage';
    END;

    IF v_key <> 'DIME' AND v_key !~ '^[A-Z0-9][A-Z0-9.-]{0,14}$' THEN
      RAISE EXCEPTION 'invalid allocation asset key';
    END IF;
    IF v_pct IS NULL OR v_pct < 0 OR v_pct > 100 THEN
      RAISE EXCEPTION 'target percentage out of range';
    END IF;
    IF v_seen ? v_key THEN
      RAISE EXCEPTION 'duplicate allocation asset key';
    END IF;

    v_seen := v_seen || jsonb_build_object(v_key, TRUE);
    v_sum := v_sum + v_pct;
    v_count := v_count + 1;
  END LOOP;

  IF ABS(v_sum - 100) > 0.01 THEN
    RAISE EXCEPTION 'allocation target total must equal 100';
  END IF;

  DELETE FROM public.portfolio_allocation_targets
  WHERE user_id = p_user_id
    AND portfolio_id = p_portfolio_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_targets)
  LOOP
    v_key := UPPER(BTRIM(v_item->>'asset_key'));
    v_pct := (v_item->>'target_pct')::NUMERIC;

    INSERT INTO public.portfolio_allocation_targets (
      user_id, portfolio_id, asset_key, target_pct
    ) VALUES (
      p_user_id, p_portfolio_id, v_key, v_pct
    );
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.save_portfolio_allocation_targets(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_portfolio_allocation_targets(UUID, UUID, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
