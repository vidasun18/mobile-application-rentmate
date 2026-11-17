import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'state.dart';
import 'strings.dart';
import 'ui.dart';

Future<bool> expressInterest(
  BuildContext context,
  Json tour, {
  List<Json>? vehicles,
}) async {
  final api = context.read<AppState>();
  try {
    final owned =
        vehicles ?? (await api.request('/vehicles') as List).cast<Json>();
    final matching = owned
        .where(
          (v) =>
              v['approved'] == true &&
              (v['seats'] as num) >= tour['passengers'] &&
              (v['type'] == tour['vehicle_type'] ||
                  tour['vehicle_type'] == 'VAN' && v['type'] == 'KDH'),
        )
        .toList();
    if (matching.isEmpty) throw ApiError(tr('noEligibleVehicle'));
    if (!context.mounted) return false;
    Json? body;
    if (matching.length == 1) {
      body = {'vehicle_id': matching.single['id']};
    } else {
      body = await formPage(context, tr('interested'), [
        FieldSpec(
          'vehicle_id',
          'vehicleType',
          options: {
            for (final v in matching)
              v['id']: '${v['model']} · ${v['registration']}',
          },
        ),
      ]);
      if (body == null) return false;
    }
    try {
      await api.request(
        '/tours/${tour['id']}/interest',
        method: 'POST',
        body: body,
      );
    } on ApiError catch (e) {
      if (e.code != 'OVERLAP_WARNING') rethrow;
      if (!context.mounted) return false;
      final proceed = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          content: Text(tr('overlap')),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(tr('cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(tr('continue')),
            ),
          ],
        ),
      );
      if (proceed != true) return false;
      await api.request(
        '/tours/${tour['id']}/interest',
        method: 'POST',
        body: {...body, 'acknowledge_overlap': true},
      );
    }
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(tr('interestSent'))));
    }
    return true;
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
    return false;
  }
}

class InterestButton extends StatefulWidget {
  final Json tour;
  final List<Json>? vehicles;
  final VoidCallback reload;
  const InterestButton({
    super.key,
    required this.tour,
    required this.reload,
    this.vehicles,
  });
  @override
  State<InterestButton> createState() => _InterestButtonState();
}

class _InterestButtonState extends State<InterestButton> {
  bool busy = false;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    child: FilledButton(
      onPressed:
          busy ||
              widget.tour['interested'] == true ||
              context.watch<AppState>().offline
          ? null
          : () async {
              setState(() => busy = true);
              final changed = await expressInterest(
                context,
                widget.tour,
                vehicles: widget.vehicles,
              );
              if (mounted) {
                setState(() => busy = false);
                if (changed) widget.reload();
              }
            },
      child: Text(
        tr(widget.tour['interested'] == true ? 'interestSent' : 'interested'),
      ),
    ),
  );
}

class OfflineTripPage extends StatelessWidget {
  final Json tour;
  const OfflineTripPage({super.key, required this.tour});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(tr('tours'))),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const OfflineBanner(),
        HeroPanel(
          '${tour['pickup']} → ${tour['destination']}',
          subtitle: date(tour['starts_at']),
        ),
        StatusChip(tour['status']),
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${tr('endsAt')}: ${date(tour['ends_at'])}'),
              Text('${tr('vehicleType')}: ${tour['vehicle_type']}'),
              Text('${tr('passengers')}: ${tour['passengers']}'),
              const SizedBox(height: 16),
              Text(tr('offlineDetail')),
            ],
          ),
        ),
      ],
    ),
  );
}
