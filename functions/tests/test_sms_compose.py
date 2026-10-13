"""SMS greeting/signature composition and the 135/250/380 segment rules (cost is counted on the full text)."""
from mychama.sms import build_messages
from shared.sms_validation import compose_sms, count_sms_segments, sms_first_name


def test_segment_breakpoints():
    assert [count_sms_segments("x" * n) for n in (0, 1, 135, 136, 250, 251, 380, 381)] == [0, 1, 1, 2, 2, 3, 3, None]


def test_compose_format_and_fallbacks():
    assert compose_sms("Meeting Friday", "Umoja Chama", "WANJIKU MUHIA") == "Dear Wanjiku,\nMeeting Friday\n\nUmoja Chama by MyChama"
    assert compose_sms("Hi", "Umoja", None).startswith("Dear Member,\n")
    assert compose_sms("Hi", "Umoja", "", fallback="Customer").startswith("Dear Customer,\n")
    assert sms_first_name("o'brien jane") == "O'Brien"
    assert sms_first_name("1234 Joe") == "Member"            # no usable letters in the first token


def test_compose_strips_non_standard_characters_from_the_chama_name():
    text = compose_sms("Hi", "Umoja \U0001F600 Wa\u00e9 Chama\n", "Al")
    assert text.endswith("\n\nUmoja Wa Chama by MyChama") and text.isascii()
    assert compose_sms("Hi", "\U0001F600", "Al").endswith("\n\nMyChama")


def test_cost_is_counted_per_recipient_on_the_full_text():
    chama = {"name": "Umoja"}
    body = "x" * (135 - len(compose_sms("", "Umoja", "Al")))        # exactly 135 chars for a short first name
    items, _ = build_messages(chama, [{"name": "Al B"}, {"name": "Wanjiku M"}], body)
    assert [segs for _, _, segs in items] == [1, 2]                  # the longer name tips over the 135 limit


def test_over_cap_is_reported_with_the_longest_length():
    chama = {"name": "Umoja"}
    body = "x" * (380 - len(compose_sms("", "Umoja", "Al")) + 1)
    items, longest = build_messages(chama, [{"name": "Al"}], body)
    assert items is None and longest == 381
