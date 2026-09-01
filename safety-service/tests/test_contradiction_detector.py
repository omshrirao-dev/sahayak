from app.contradiction_detector import get_contradiction_detector


def test_agreeing_sources():
    result = get_contradiction_detector().classify(
        "Clinician note: patient reports feeling stable and engaged.",
        "Check-in data: mood scores have been consistently high this week.",
    )
    assert result.label == "AGREE"


def test_contradictory_sources_not_averaged():
    """Edge Case 4: contradictory sources must resolve to CONTRADICT, never a blended state."""
    result = get_contradiction_detector().classify(
        "Clinician note: patient is doing well and engaging fully with treatment.",
        "Check-in data: mood scores have declined over the last three check-ins.",
    )
    assert result.label == "CONTRADICT"
    assert result.label in ("AGREE", "PARTIAL", "CONTRADICT", "INSUFFICIENT")  # never silently blended


def test_denial_vs_explicit_crisis_statement_is_contradiction():
    result = get_contradiction_detector().classify(
        "Clinician note: patient denies any thoughts of self-harm.",
        "Patient message: I've been thinking about ending my life.",
    )
    assert result.label == "CONTRADICT"


def test_insufficient_data_flagged_as_insufficient():
    result = get_contradiction_detector().classify(
        "Clinician note: general check-in, nothing notable discussed.",
        "Check-in data: no check-ins recorded for this period yet.",
    )
    assert result.label == "INSUFFICIENT"


def test_partial_overlap_is_partial_or_contradict_not_agree():
    result = get_contradiction_detector().classify(
        "Clinician note: patient's mood has improved since the last session.",
        "Check-in data: one low mood score this week, otherwise no clear trend.",
    )
    assert result.label != "AGREE"
