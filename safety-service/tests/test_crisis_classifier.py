from app.crisis_classifier import get_crisis_classifier


def test_explicit_crisis_language_flagged():
    result = get_crisis_classifier().classify(
        "I've been thinking about ending my life and I have a plan."
    )
    assert result.is_crisis is True
    assert result.matched_keyword is not None


def test_subtle_indirect_crisis_language_flagged():
    """Edge Case 1: genuine but indirect crisis language must not be missed."""
    result = get_crisis_classifier().classify(
        "I've stopped making plans because I don't think I'll be around much longer."
    )
    assert result.is_crisis is True


def test_sarcastic_language_not_flagged():
    """Edge Case 2: crisis-adjacent words used sarcastically should not trigger."""
    result = get_crisis_classifier().classify(
        "Ugh, I could just die of embarrassment from that meeting."
    )
    assert result.is_crisis is False


def test_hyperbolic_language_not_flagged():
    result = get_crisis_classifier().classify("This traffic is literally killing me today.")
    assert result.is_crisis is False


def test_neutral_check_in_not_flagged():
    result = get_crisis_classifier().classify(
        "I had a good week, went for a walk every day and slept well."
    )
    assert result.is_crisis is False


def test_hard_keyword_override_forces_high_confidence():
    result = get_crisis_classifier().classify("I want to kill myself tonight.")
    assert result.is_crisis is True
    assert result.probability >= 0.99
