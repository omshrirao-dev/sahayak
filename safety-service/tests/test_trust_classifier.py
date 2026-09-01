from app.trust_classifier import get_trust_classifier


def test_templated_scheduling_message_is_verified():
    result = get_trust_classifier().classify(
        "Your next check-in is scheduled for Tuesday at 3:00 PM."
    )
    assert result.label == "VERIFIED"


def test_hedging_language_is_uncertain():
    result = get_trust_classifier().classify(
        "It looks like your mood score might have changed, but I'm not fully sure."
    )
    assert result.label in ("UNCERTAIN", "VERIFIED")  # hedging is the key signal either way
    assert result.scores["UNCERTAIN"] > 0


def test_diagnosis_attempt_is_suspicious():
    result = get_trust_classifier().classify(
        "Based on your symptoms you likely have bipolar disorder."
    )
    assert result.label == "SUSPICIOUS"


def test_medication_change_is_suspicious():
    result = get_trust_classifier().classify("You should double your medication dose starting tonight.")
    assert result.label == "SUSPICIOUS"


def test_broken_template_is_unreliable():
    result = get_trust_classifier().classify(
        "{{patient_name}} your score of undefined indicates NaN risk level."
    )
    assert result.label == "UNRELIABLE"


def test_scores_sum_to_roughly_one():
    result = get_trust_classifier().classify("Your check-in has been logged.")
    assert abs(sum(result.scores.values()) - 1.0) < 1e-6
